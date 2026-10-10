// echocrypt.cs - tiny native helper to encrypt/decrypt a file at rest.
//
// WHY THIS EXISTS:
// `browser_storage_state` writes every cookie + localStorage entry the user is
// signed into as PLAINTEXT JSON. During a stress test that produced a 1.9 MB
// file containing 768 live auth cookies (Google, GitHub, Daraz, a university
// portal) in the user's project directory - one `git add .` from committing
// real credentials. Found during a live stress test of the MCP tool surface.
//
// The fix is Windows DPAPI: the key is tied to the user's Windows account and
// cannot be exported. A copied file is useless on any other machine or account
// but decrypts transparently for the user who owns it. No password, no prompt,
// nothing to configure.
//
// It must be a separate .exe (not a library) because the patch that uses it
// edits a bundled JS file - a string replacement cannot inject a .NET
// reference. Same pattern as echowin.exe.
//
// WHY NOT A PASSWORD: the product requirement is frictionless ("butter smooth").
// A user-managed passphrase can be weak, lost, or reused; DPAPI cannot be
// phished, guessed, or forgotten. Accepted limitation: this does NOT protect
// against malware already running as the user - nothing can.
//
// USAGE:
//   echocrypt.exe encrypt <in> <out>    protect  (DPAPI CurrentUser)
//   echocrypt.exe decrypt <in> <out>    unprotect
//   echocrypt.exe encrypt-stdin <out>   protect, reading PLAINTEXT FROM STDIN
//   echocrypt.exe decrypt-stdin <in>    unprotect, writing PLAINTEXT TO STDOUT
//   echocrypt.exe probe                 exit 0 if DPAPI works for this user
//
// The stdin modes matter for security: on the SAVE path the plaintext never
// touches the disk at all. (On the RESTORE path Playwright's setStorageState()
// requires a real file path, so a temp plaintext file is unavoidable there -
// the caller must delete it immediately after use.)
//
// Exit codes: 0 ok, 1 crypto failure (fail CLOSED - never write plaintext),
// 2 bad args, 3 IO failure.
//
// Build:
//   csc.exe -nologo -out:echocrypt.exe -r:System.Security.dll echocrypt.cs
// (csc.exe ships with .NET Framework at C:\Windows\Microsoft.NET\Framework64\v4.0.30319\)

using System;
using System.IO;
using System.Security.Cryptography;

public class EchoCrypt
{
    // Every failure path here is FATAL on purpose: the caller must never fall
    // back to an unencrypted write, or we would reintroduce the exact leak this
    // helper exists to prevent.
    private const int EXIT_OK = 0;
    private const int EXIT_CRYPTO = 1;
    private const int EXIT_ARGS = 2;
    private const int EXIT_IO = 3;

    private static void Fail(string message, int code)
    {
        Console.Error.WriteLine(message);
        Environment.Exit(code);
    }

    // Reads the ENTIRE stream. stdin is not seekable, so a one-shot copy.
    private static byte[] ReadAllStdin()
    {
        using (MemoryStream buffer = new MemoryStream())
        {
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = Console.OpenStandardInput().Read(chunk, 0, chunk.Length)) > 0)
                buffer.Write(chunk, 0, read);
            return buffer.ToArray();
        }
    }

    private static void WriteAtomic(string outputPath, byte[] data)
    {
        // Atomic write: a crash mid-write must not leave a truncated (and
        // therefore undecryptable) session file behind.
        string tmp = outputPath + ".tmp";
        File.WriteAllBytes(tmp, data);
        if (File.Exists(outputPath))
            File.Delete(outputPath);
        File.Move(tmp, outputPath);
    }

    public static int Main(string[] args)
    {
        try
        {
            // -- encrypt-stdin <out> : plaintext arrives on stdin ----------
            if (args.Length == 2 && args[0] == "encrypt-stdin")
            {
                byte[] plain = ReadAllStdin();
                byte[] cipher = ProtectedData.Protect(
                    plain, null, DataProtectionScope.CurrentUser);
                WriteAtomic(args[1], cipher);
                Console.Error.WriteLine(
                    "encrypt-stdin ok in=" + plain.Length + " out=" + cipher.Length);
                return EXIT_OK;
            }

            // -- decrypt-stdin <in> : plaintext leaves on stdout ----------
            if (args.Length == 2 && args[0] == "decrypt-stdin")
            {
                byte[] plain = ProtectedData.Unprotect(
                    File.ReadAllBytes(args[1]), null, DataProtectionScope.CurrentUser);
                Stream stdout = Console.OpenStandardOutput();
                stdout.Write(plain, 0, plain.Length);
                stdout.Flush();
                Console.Error.WriteLine("decrypt-stdin ok out=" + plain.Length);
                return EXIT_OK;
            }

            // -- encrypt|decrypt <in> <out> : file to file ----------------
            if (args.Length == 3 &&
                (args[0] == "encrypt" || args[0] == "decrypt"))
            {
                string mode = args[0];
                byte[] input = File.ReadAllBytes(args[1]);
                byte[] output;
                if (mode == "encrypt")
                    output = ProtectedData.Protect(
                        input, null, DataProtectionScope.CurrentUser);
                else
                    output = ProtectedData.Unprotect(
                        input, null, DataProtectionScope.CurrentUser);
                WriteAtomic(args[2], output);
                Console.Error.WriteLine(
                    mode + " ok in=" + input.Length + " out=" + output.Length);
                return EXIT_OK;
            }

            // -- probe ------------------------------------------------------
            if (args.Length == 1 && args[0] == "probe")
            {
                byte[] probe = ProtectedData.Protect(
                    new byte[] { 1, 2, 3 }, null, DataProtectionScope.CurrentUser);
                byte[] back = ProtectedData.Unprotect(
                    probe, null, DataProtectionScope.CurrentUser);
                if (back.Length != 3 || back[0] != 1 || back[1] != 2 || back[2] != 3)
                    Fail("echocrypt: probe round-trip mismatch", EXIT_CRYPTO);
                Console.Error.WriteLine("echocrypt: probe ok (DPAPI available)");
                return EXIT_OK;
            }

            Console.Error.WriteLine(
                "usage: echocrypt.exe encrypt|decrypt <in> <out>");
            Console.Error.WriteLine(
                "       echocrypt.exe encrypt-stdin <out>");
            Console.Error.WriteLine(
                "       echocrypt.exe decrypt-stdin <in>");
            Console.Error.WriteLine(
                "       echocrypt.exe probe");
            return EXIT_ARGS;
        }
        catch (CryptographicException ex)
        {
            // Most common cause: the file was encrypted by a DIFFERENT Windows
            // account, or the user profile was reset. Surface it plainly - this
            // is a real, actionable condition.
            Fail("echocrypt: crypto failed (" + ex.Message +
                 "). The file may belong to another Windows account, or the " +
                 "user profile may have been reset. No file was written.",
                 EXIT_CRYPTO);
            return EXIT_CRYPTO;
        }
        catch (Exception ex)
        {
            Fail("echocrypt: " + ex.Message, EXIT_IO);
            return EXIT_IO;
        }
    }
}
import '@mantine/core/styles.css';
import './styles/tokens.css'
import './api'  // API compatibility layer (replaces Electron preload)
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import App from './App.tsx'

const theme = createTheme({
  primaryColor: 'cyan',
  defaultRadius: 6,
  cursorType: 'pointer',
  fontFamily: "'Cascadia Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
  fontFamilyMonospace: "'Cascadia Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
  colors: {
    dark: [
      '#c9d1d9', '#8b949e', '#6e7681', '#484f58',
      '#30363d', '#21262d', '#161b22', '#161b22',
      '#0d1117', '#0d1117',
    ],
    cyan: [
      '#caeaff', '#a5d4ff', '#79b8ff', '#58a6ff',
      '#58a6ff', '#58a6ff', '#58a6ff', '#58a6ff',
      '#58a6ff', '#1f6feb',
    ],
  },
  primaryShade: { light: 8, dark: 8 },
  components: {
    Tooltip: { defaultProps: { color: '#161b22' } },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} defaultColorScheme="dark">
    <App />
  </MantineProvider>,
)

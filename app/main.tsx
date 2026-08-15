import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { App } from './App'
import { wagmiConfig } from './config/wagmi'
import { confetti } from './shell/confetti'
import './styles.css'

if (import.meta.env.DEV) {
  ;(window as unknown as { __stonkzConfetti?: typeof confetti }).__stonkzConfetti =
    confetti
}

const queryClient = new QueryClient()
const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

import { Component, ErrorInfo, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected render error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GRIDLOCK UI boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-[#070B13] text-slate-200 flex flex-col items-center justify-center p-6 text-center font-mono gap-3">
          <div className="text-sm font-bold text-[#FF5C77]">SYS_FAULT // RECOVERING BOARD</div>
          <p className="text-xs text-slate-400 max-w-sm">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-[#00F0FF] text-[#050B14] font-bold text-xs uppercase cursor-pointer"
          >
            Reload OVERCLOCK
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

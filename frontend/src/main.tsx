import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@/index.css';
import App from '@/App';

// Code-split each screen into its own lazy chunk.
// Three.js modules (imported by HomeScreen→HomeBackground and GameplayScreen→GameCanvas)
// are automatically grouped into a shared vendor-three chunk via vite.config.ts.
const HomeScreen      = lazy(() => import('@/screens/HomeScreen'));
const LoadingScreen   = lazy(() => import('@/screens/LoadingScreen'));
const GameplayScreen  = lazy(() => import('@/screens/GameplayScreen'));
const ResultsScreen   = lazy(() => import('@/screens/ResultsScreen'));

// Dark background placeholder shown while a screen chunk is downloading.
// Matches the game background color so there's no flash of white.
function ScreenFallback() {
  return <div style={{ width: '100%', height: '100%', background: '#080810' }} />;
}

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/',        element: <Suspense fallback={<ScreenFallback />}><HomeScreen /></Suspense> },
      { path: '/loading', element: <Suspense fallback={<ScreenFallback />}><LoadingScreen /></Suspense> },
      { path: '/play',    element: <Suspense fallback={<ScreenFallback />}><GameplayScreen /></Suspense> },
      { path: '/results', element: <Suspense fallback={<ScreenFallback />}><ResultsScreen /></Suspense> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@/index.css';
import App from '@/App';
import HomeScreen from '@/screens/HomeScreen';
import SongSelectScreen from '@/screens/SongSelectScreen';
import LoadingScreen from '@/screens/LoadingScreen';
import GameplayScreen from '@/screens/GameplayScreen';
import ResultsScreen from '@/screens/ResultsScreen';

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/',        element: <HomeScreen /> },
      { path: '/select',  element: <SongSelectScreen /> },
      { path: '/loading', element: <LoadingScreen /> },
      { path: '/play',    element: <GameplayScreen /> },
      { path: '/results', element: <ResultsScreen /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

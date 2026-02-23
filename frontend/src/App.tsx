import { Outlet, useLocation } from 'react-router-dom';
import SongReadyToast from '@/components/SongReadyToast';

function App() {
  const { pathname } = useLocation();

  return (
    <div className="h-full w-full bg-game-bg">
      {/* key forces unmount/remount on route change, triggering the fade-in animation */}
      <div key={pathname} className="screen-fade-in h-full w-full">
        <Outlet />
      </div>
      {/* Global notification: fires on any screen when a YouTube analysis job completes */}
      <SongReadyToast />
    </div>
  );
}

export default App;

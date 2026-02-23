import { Outlet, useLocation } from 'react-router-dom';

function App() {
  const { pathname } = useLocation();

  return (
    <div className="h-full w-full bg-game-bg">
      {/* key forces unmount/remount on route change, triggering the fade-in animation */}
      <div key={pathname} className="screen-fade-in h-full w-full">
        <Outlet />
      </div>
    </div>
  );
}

export default App;

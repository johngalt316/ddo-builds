import { type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Home } from '@/pages/Home';
import { BuildEditor } from '@/pages/BuildEditor';
import { NotFound } from '@/pages/NotFound';
import { useGameData } from '@/hooks/useGameData';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'builder', element: <BuildEditor /> },
      { path: 'b/:id', element: <BuildEditor /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

function DataLoader({ children }: { children: ReactNode }) {
  useGameData(); // triggers background load; status is available via useGameDataStore elsewhere
  return <>{children}</>;
}

export function App() {
  return (
    <DataLoader>
      <RouterProvider router={router} />
    </DataLoader>
  );
}

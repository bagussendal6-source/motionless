import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Editor } from './pages/Editor.tsx';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/new" element={<Dashboard startNew />} />
        <Route path="/p/:id" element={<Editor />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}

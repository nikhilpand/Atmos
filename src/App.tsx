import React from 'react';
import { WeatherProvider } from './context/WeatherContext';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { Forecast } from './components/Forecast';
import { Maps } from './components/Maps';
import { Globe, BarChart3 } from 'lucide-react';
import { useStore } from './store/useStore';

export default function App() {
  const activeTab = useStore((state) => state.activeTab);

  return (
    <WeatherProvider>
      <div className="min-h-screen flex flex-col bg-background text-on-surface">
        <Navbar />
        
        <main className="flex-grow">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'forecast' && <Forecast />}
          {activeTab === 'maps' && <Maps />}
        </main>

        {/* Footer */}
        <footer className="w-full py-8 mt-auto bg-slate-950">
          <div className="flex flex-col md:flex-row justify-between items-center px-12 gap-4">
            <span className="font-jakarta text-xs uppercase tracking-widest text-slate-500">
              © 2024 Atmospheric Intelligence
            </span>
            <div className="flex gap-8">
              <a href="#" className="font-jakarta text-xs uppercase tracking-widest text-slate-500 hover:text-primary transition-all opacity-80 hover:opacity-100">Privacy Policy</a>
              <a href="#" className="font-jakarta text-xs uppercase tracking-widest text-slate-500 hover:text-primary transition-all opacity-80 hover:opacity-100">Data Sources</a>
              <a href="#" className="font-jakarta text-xs uppercase tracking-widest text-slate-500 hover:text-primary transition-all opacity-80 hover:opacity-100">API Access</a>
            </div>
            <div className="flex gap-4">
              <Globe className="text-slate-500 hover:text-primary cursor-pointer transition-colors" size={20} />
              <BarChart3 className="text-slate-500 hover:text-primary cursor-pointer transition-colors" size={20} />
            </div>
          </div>
        </footer>

        {/* Material Symbols Link */}
        <link 
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" 
          rel="stylesheet" 
        />
      </div>
    </WeatherProvider>
  );
}

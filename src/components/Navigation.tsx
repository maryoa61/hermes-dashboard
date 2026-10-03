import React from 'react';
import { LayoutDashboard, MessageSquare, PlayCircle, Settings, Bug } from 'lucide-react';
import { translations } from '../i18n/translations';

export type NavTab = 'dashboard' | 'chat' | 'runs' | 'settings' | 'debug';

interface NavigationProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  language: 'en' | 'fa';
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  language,
}) => {
  const t = translations[language];

  const tabs: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'dashboard',
      label: t.dashboard,
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      id: 'chat',
      label: t.chat,
      icon: <MessageSquare className="w-5 h-5" />,
    },
    {
      id: 'runs',
      label: t.runs,
      icon: <PlayCircle className="w-5 h-5" />,
    },
    {
      id: 'settings',
      label: t.settings,
      icon: <Settings className="w-5 h-5" />,
    },
    {
      id: 'debug',
      label: t.debug,
      icon: <Bug className="w-5 h-5" />,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#002b36]/95 backdrop-blur-lg border-t border-[#073642] pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl select-none">
      <div className="grid grid-cols-5 max-w-lg mx-auto h-14">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] transition-all relative ${
                isActive
                  ? 'text-[#ff7b25]'
                  : 'text-[#586e75] hover:text-[#93a1a1] active:text-[#eee8d5]'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 w-8 h-0.5 bg-[#ff7b25] rounded-full shadow-[0_0_8px_#ff7b25]" />
              )}
              <div className={`transition-transform ${isActive ? 'scale-110' : ''}`}>
                {tab.icon}
              </div>
              <span className={`text-[10px] mt-1 font-medium truncate max-w-[64px] ${isActive ? 'font-bold' : ''}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

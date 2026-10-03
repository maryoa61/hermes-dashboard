/**
 * Hermes Agent Mobile Client PWA
 * Mobile-first Progressive Web App dashboard and chat client for self-hosted Hermes Agent
 */

import React, { useEffect, useState } from 'react';
import {
  AppSettings,
  HermesServerProfile,
} from './types/hermes';
import {
  loadActiveProfileId,
  loadProfiles,
  loadSettings,
  saveActiveProfileId,
  saveProfiles,
  saveSettings,
  subscribeToStorageErrors,
} from './utils/storage';
import { useHeartbeat } from './hooks/useHeartbeat';
import { Header } from './components/Header';
import { Navigation, NavTab } from './components/Navigation';
import { DashboardView } from './views/DashboardView';
import { ChatView } from './views/ChatView';
import { RunsView } from './views/RunsView';
import { SettingsView } from './views/SettingsView';
import { DebugView } from './views/DebugView';
import { WifiOff, AlertOctagon, X } from 'lucide-react';

export default function App() {
  const [profiles, setProfiles] = useState<HermesServerProfile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => loadActiveProfileId());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Subscribe to IndexedDB storage errors
  useEffect(() => {
    subscribeToStorageErrors((err) => {
      setStorageError(err);
    });
  }, []);

  // Active profile object
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || (profiles.length > 0 ? profiles[0] : null);

  // Synchronize active profile id if needed
  useEffect(() => {
    if (activeProfile && activeProfile.id !== activeProfileId) {
      setActiveProfileId(activeProfile.id);
      saveActiveProfileId(activeProfile.id);
    }
  }, [activeProfile, activeProfileId]);

  // Online / Offline browser detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync RTL / LTR document direction with chosen language
  useEffect(() => {
    const lang = settings.language || 'fa';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [settings.language]);

  // Real heartbeat hook
  const { healthState, refreshHealth } = useHeartbeat(
    activeProfile,
    settings.heartbeatIntervalSec || 20
  );

  const handleSaveProfiles = (updatedProfiles: HermesServerProfile[]) => {
    setProfiles(updatedProfiles);
    saveProfiles(updatedProfiles);
  };

  const handleSelectActiveProfile = (id: string) => {
    setActiveProfileId(id);
    saveActiveProfileId(id);
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleToggleLanguage = () => {
    const nextLang = settings.language === 'fa' ? 'en' : 'fa';
    const updated = { ...settings, language: nextLang as 'en' | 'fa' };
    setSettings(updated);
    saveSettings(updated);
  };

  return (
    <div
      className="flex flex-col h-[100dvh] w-full bg-[#002b36] text-[#93a1a1] overflow-hidden select-none"
      dir={settings.language === 'fa' ? 'rtl' : 'ltr'}
    >
      {/* Offline Toast Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white px-3 py-1 text-center text-xs font-medium flex items-center justify-center gap-1.5 z-50 shrink-0">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Browser is offline. Showing cached interface shell.</span>
        </div>
      )}

      {/* Storage Error Banner per Requirement 8 */}
      {storageError && (
        <div className="bg-rose-700 text-white px-3 py-1.5 text-xs font-medium flex items-center justify-between z-50 shrink-0 shadow-md">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>{storageError}</span>
          </div>
          <button
            onClick={() => setStorageError(null)}
            className="p-1 hover:bg-rose-800 rounded"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main App Header */}
      <Header
        activeProfile={activeProfile}
        profiles={profiles}
        onSelectProfile={handleSelectActiveProfile}
        healthState={healthState}
        onRefreshHealth={refreshHealth}
        language={settings.language}
        onToggleLanguage={handleToggleLanguage}
        onOpenSettings={() => setActiveTab('settings')}
      />

      {/* Active Tab View */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'dashboard' && (
          <DashboardView
            profile={activeProfile}
            healthState={healthState}
            onRefreshHealth={refreshHealth}
            language={settings.language}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'chat' && (
          <ChatView
            profile={activeProfile}
            systemPromptLayer={settings.systemPromptAddition}
            language={settings.language}
            onNavigateSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'runs' && (
          <RunsView
            profile={activeProfile}
            language={settings.language}
            onNavigateSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSaveProfiles={handleSaveProfiles}
            onSelectActiveProfile={handleSelectActiveProfile}
            settings={settings}
            onSaveSettings={handleSaveSettings}
            language={settings.language}
            onLanguageChange={(lang) => {
              const updated = { ...settings, language: lang };
              setSettings(updated);
              saveSettings(updated);
            }}
          />
        )}

        {activeTab === 'debug' && <DebugView language={settings.language} />}
      </main>

      {/* Bottom Navigation */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        language={settings.language}
      />
    </div>
  );
}

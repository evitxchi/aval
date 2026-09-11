"use client";
import { useTranslations } from 'next-intl';
import { useAppearance } from './appearance-provider';
import type { ChatWindowBackground } from '@/lib/appearance';

export function ChatWindowPreferences() {
  const t = useTranslations('ChatPanel');
  const a = useTranslations('Appearance');
  const { appearance, saved, setAppearance, save, loading, saving, error, reload } = useAppearance();
  const selected = appearance.chatWindowBackground ?? 'white';
  const dirty = selected !== (saved.chatWindowBackground ?? 'white');
  return <section className="settings-section chat-window-preferences">
    <div className="settings-section-label"><h3>{t('windowBackground')}</h3><p>{t('windowBackgroundHelp')}</p></div>
    <div className="settings-choice-group" role="group" aria-label={t('windowBackground')}>
      {(['white', 'glass'] as ChatWindowBackground[]).map(value => <button key={value} type="button" aria-pressed={selected === value} disabled={loading || saving || error === 'load'} onClick={() => setAppearance({ ...appearance, chatWindowBackground: value })}>{t(value === 'white' ? 'whiteBackground' : 'glassBackground')}</button>)}
    </div>
    <div className="chat-window-preference-save">
      <p role="status">{error ? a(error === 'load' ? 'loadError' : 'saveError') : saving ? a('saving') : dirty ? a('unsaved') : a('saved')}</p>
      {error === 'load' ? <button type="button" className="soft-button" onClick={reload}>{a('retry')}</button> : <button type="button" className="soft-button" disabled={!dirty || saving || loading} onClick={() => void save()}>{saving ? a('saving') : a('save')}</button>}
    </div>
  </section>;
}

// DompetKu v1.0.2 — chat tab.
// The composer stays above the virtual keyboard: the viewport uses
// interactive-widget=resizes-content and the list scrolls to the newest
// message whenever the viewport resizes. The typing indicator shows for as
// long as the reply is long, with animated dots.

import { useEffect, useRef, useState } from 'react';
import type { ChatEngine } from '../lib/chat';
import { filterCommands, slashQuery } from '../lib/commands';
import type {
  Category,
  ChatMessage,
  Settings,
  Transaction,
  Wallet,
} from '../lib/types';
import { ChatSettingsSheet } from './ChatSettingsSheet';

export function Chat({
  engine,
  wallets,
  settings,
  messages,
  categories,
  transactions,
  onMessages,
  onDataChanged,
  onSaveSettings,
  onOpenSettings,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onClearChat,
}: {
  engine: ChatEngine;
  wallets: Wallet[];
  settings: Settings;
  messages: ChatMessage[];
  categories: Category[];
  transactions: Transaction[];
  onMessages: (messages: ChatMessage[]) => Promise<void>;
  onDataChanged: () => Promise<void>;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenSettings: () => void;
  onAddCategory: (name: string) => Promise<void>;
  onRenameCategory: (id: string, name: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onClearChat: () => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Chat settings sheet (categories, clear chat) from the gear button.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Slash-command menu: which suggestion is highlighted, and whether the
  // user dismissed the menu for the current query (Escape).
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [menuHidden, setMenuHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The menu only shows while the user is still typing a command name.
  // Once the command is chosen (a space follows it), the menu shuts.
  const query = slashQuery(input);
  const matches = query === null || menuHidden ? [] : filterCommands(query);
  const menuOpen = matches.length > 0;

  function chooseCommand(usage: string): void {
    setInput(usage);
    setActiveIndex(null);
    setMenuHidden(true);
    inputRef.current?.focus();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!menuOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev === null ? 0 : Math.min(prev + 1, matches.length - 1),
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev === null ? matches.length - 1 : Math.max(prev - 1, 0),
      );
    } else if (e.key === 'Enter' && activeIndex !== null) {
      // Accept the highlighted suggestion instead of sending.
      e.preventDefault();
      chooseCommand(matches[activeIndex].usage);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMenuHidden(true);
      setActiveIndex(null);
    }
  }

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  const lastMessage = messages[messages.length - 1];

  function scrollToBottom(): void {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  useEffect(() => {
    // When the virtual keyboard opens, the visual viewport shrinks — keep
    // the newest message (and the composer) visible.
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onResize = (): void => {
      scrollToBottom();
    };
    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
  }, []);

  const showKeyReminder =
    !settings.geminiApiKey &&
    (settings.keyReminderDismissedAt === null ||
      new Date(settings.keyReminderDismissedAt).toDateString() !==
        new Date().toDateString());

  async function send(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setInput('');
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: clean,
      createdAt: Date.now(),
    };
    await onMessages([userMessage]);
    const reply = await engine.handle(clean, lastAssistant?.text ?? null);
    // The engine may have written a transaction or a budget straight to
    // the database, so refresh the app state before showing the reply.
    await onDataChanged();
    // The typing indicator stays up while the reply is "being typed".
    if (reply.typingMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, reply.typingMs));
    }
    if (reply.messages.length > 0) {
      await onMessages(reply.messages);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  async function dismissKeyReminder(): Promise<void> {
    await onSaveSettings({ keyReminderDismissedAt: Date.now() });
  }

  return (
    <div className="chat-screen">
      <header className="top-bar">
        <div className="brand">
          <span className="avatar small" aria-hidden="true">
            D
          </span>
          <div className="brand-text">
            <h1>DompetKu</h1>
            <p>Asisten anggaran · di perangkatmu</p>
          </div>
        </div>
        <span className="wallet-pill">
          {wallets.length === 1 ? wallets[0].name : `${wallets.length} dompet`}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Pengaturan chat"
          onClick={() => setSheetOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
              fill="currentColor"
            />
          </svg>
        </button>
      </header>

      {showKeyReminder ? (
        <div className="key-reminder" role="status">
          <p>
            Pasang kunci API Gemini di Pengaturan kalau mau aku lebih paham
            kalimatmu. Tanpa kunci pun aku tetap jalan.
          </p>
          <div className="key-reminder-actions">
            <button type="button" onClick={onOpenSettings}>
              Buka Pengaturan
            </button>
            <button type="button" onClick={() => void dismissKeyReminder()}>
              Nanti saja
            </button>
          </div>
        </div>
      ) : null}

      <div className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="msg assistant">
            <p>
              Halo. Tulis pengeluaranmu, misalnya Makan siang 45rb, atau tanya
              berapa pengeluaranmu hari ini.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <p>{m.text}</p>
              {m.card ? (
                <div className={`card tone-${m.card.tone ?? 'info'}`}>
                  <p className="card-title">{m.card.title}</p>
                  {m.card.rows.map((row) => (
                    <div className="card-row" key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                  {m.card.note ? <p className="card-note">{m.card.note}</p> : null}
                </div>
              ) : null}
              <span className="time">
                {new Date(m.createdAt).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
        )}
        {sending ? (
          <div className="msg assistant">
            <p className="typing" aria-label="DompetKu sedang mengetik">
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Mengetik
            </p>
          </div>
        ) : null}
      </div>

      {lastMessage?.role === 'assistant' && lastMessage.quickReplies ? (
        <div className="chips" aria-label="Balasan cepat">
          {lastMessage.quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => void send(reply)}
              disabled={sending}
            >
              {reply}
            </button>
          ))}
        </div>
      ) : null}

      {menuOpen ? (
        <div
          className="slash-menu"
          id="slash-menu"
          role="listbox"
          aria-label="Perintah"
        >
          {matches.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              id={`slash-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className="slash-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chooseCommand(cmd.usage)}
            >
              <span className="cmd">/{cmd.name}</span>
              <span className="desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="visually-hidden" htmlFor="chat-input">
          Tulis pesan
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveIndex(null);
            setMenuHidden(false);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Tulis pengeluaran atau pertanyaan…"
          enterKeyHint="send"
          autoComplete="off"
          disabled={sending}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? 'slash-menu' : undefined}
          aria-activedescendant={
            activeIndex !== null ? `slash-opt-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
        />
        <button
          type="submit"
          className="send"
          aria-label="Kirim pesan"
          disabled={sending || !input.trim()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3 11.5 21 3l-8.5 18-2.5-7.5Z" fill="currentColor" />
          </svg>
        </button>
      </form>

      <ChatSettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        categories={categories}
        transactions={transactions}
        messageCount={messages.length}
        onAddCategory={onAddCategory}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onClearChat={onClearChat}
      />
    </div>
  );
}

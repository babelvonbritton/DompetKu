// DompetKu v1.0.0 — category customization in the chat settings sheet
// (gear button in the chat header).
// Add, rename and delete categories. Deleting moves that category's
// transactions to Lainnya, so nothing is ever orphaned; Lainnya itself
// cannot be deleted because it is the fallback. The chat already matches a
// custom category by name (see findCategoryId in parser.ts), so a new
// category works in chat the moment it is added.

import { useState } from 'react';
import { STARTER_CATEGORIES } from '../lib/categories';
import type { Category, Transaction } from '../lib/types';

const SEED_ORDER = STARTER_CATEGORIES.map((c) => c.id);

function displayOrder(categories: Category[]): Category[] {
  const seed = SEED_ORDER.map((id) => categories.find((c) => c.id === id)).filter(
    (c): c is Category => c !== undefined,
  );
  const custom = categories
    .filter((c) => !c.builtin)
    .sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
  return [...seed, ...custom];
}

export function CategorySection({
  categories,
  transactions,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
}: {
  categories: Category[];
  transactions: Transaction[];
  onAddCategory: (name: string) => Promise<void>;
  onRenameCategory: (id: string, name: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function nameTaken(name: string, exceptId?: string): boolean {
    const clean = name.trim().toLowerCase();
    return categories.some(
      (c) => c.id !== exceptId && c.name.toLowerCase() === clean,
    );
  }

  async function add(): Promise<void> {
    const clean = newName.trim().slice(0, 40);
    if (!clean) {
      setError('Beri nama kategorinya dulu, contoh: Jajan.');
      return;
    }
    if (nameTaken(clean)) {
      setError(`Kategori "${clean}" sudah ada.`);
      return;
    }
    await onAddCategory(clean);
    setNewName('');
    setError('');
  }

  async function rename(): Promise<void> {
    if (!editingId) return;
    const clean = editName.trim().slice(0, 40);
    if (!clean) {
      setError('Nama kategori tidak boleh kosong.');
      return;
    }
    if (nameTaken(clean, editingId)) {
      setError(`Kategori "${clean}" sudah ada.`);
      return;
    }
    await onRenameCategory(editingId, clean);
    setEditingId(null);
    setError('');
  }

  function countUsed(id: string): number {
    return transactions.filter((t) => t.categoryId === id).length;
  }

  return (
    <section className="settings-section" aria-labelledby="category-heading">
      <h2 id="category-heading">Kategori</h2>
      <p>
        Kategori dipakai chat untuk menggolongkan pengeluaranmu. Sebut saja
        nama kategorinya di chat — contohnya "Beli jajan 20rb" masuk ke Jajan
        kalau kategorinya ada.
      </p>
      <ul className="category-list">
        {displayOrder(categories).map((category) => {
          const used = countUsed(category.id);
          const isEditing = editingId === category.id;
          const isConfirming = confirmId === category.id;
          return (
            <li key={category.id}>
              {isEditing ? (
                <>
                  <div className="category-edit">
                    <label
                      className="visually-hidden"
                      htmlFor={`cat-edit-${category.id}`}
                    >
                      Nama baru untuk {category.name}
                    </label>
                    <input
                      id={`cat-edit-${category.id}`}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={40}
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void rename()}
                  >
                    Simpan
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditingId(null);
                      setError('');
                    }}
                  >
                    Batal
                  </button>
                </>
              ) : (
                <>
                  <span className="category-name">{category.name}</span>
                  {category.builtin ? (
                    <span className="category-tag">Bawaan</span>
                  ) : null}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                      setConfirmId(null);
                      setError('');
                    }}
                  >
                    Ubah
                  </button>
                  {category.id === 'lainnya' ? null : isConfirming ? (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => {
                        setConfirmId(null);
                        void onDeleteCategory(category.id);
                      }}
                    >
                      Yakin hapus?{' '}
                      {used > 0
                        ? `${used} catatan dipindah ke Lainnya.`
                        : 'Kategori ini belum dipakai.'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => {
                        setConfirmId(category.id);
                        setEditingId(null);
                      }}
                    >
                      Hapus
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="field">
        <label htmlFor="category-new-name">Kategori baru</label>
        <input
          id="category-new-name"
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (error) setError('');
          }}
          placeholder="Contoh: Jajan"
          maxLength={40}
          autoComplete="off"
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button-primary small"
        onClick={() => void add()}
      >
        Tambah kategori
      </button>
      <p className="hint">
        Lainnya tidak bisa dihapus — catatan yang tidak cocok ke kategori lain
        masuk ke sana.
      </p>
    </section>
  );
}

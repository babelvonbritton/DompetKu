// DompetKu v1.0.0 — settings seed + legacy model migration tests.
// Google limits the 2.5 models to keys that already used them, so a stored
// 2.5 model breaks every Gemini call for a fresh key. Booting must move it.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, DEFAULT_MODEL, ensureSeed, defaultSettings } from './db';
import { createStores } from './stores';
import type { Settings } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ensureSeed', () => {
  it('seeds the current default model on a fresh database', async () => {
    await ensureSeed();
    const settings = await db.settings.get('main');
    expect(settings?.geminiModel).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('gemini-3.5-flash-lite');
  });

  it('moves a stored legacy 2.5 model to the current default', async () => {
    await db.settings.add({
      ...defaultSettings(),
      geminiModel: 'gemini-2.5-flash-lite',
    });
    await ensureSeed();
    const settings = await db.settings.get('main');
    expect(settings?.geminiModel).toBe('gemini-3.5-flash-lite');
  });

  it('leaves a model the user typed themselves alone', async () => {
    await db.settings.add({
      ...defaultSettings(),
      geminiModel: 'gemini-2.5-flash',
    });
    await ensureSeed();
    const settings = await db.settings.get('main');
    expect(settings?.geminiModel).toBe('gemini-2.5-flash');
  });

  it('fills in the parser fallback for settings stored before the field existed', async () => {
    const legacy = { ...defaultSettings() };
    delete (legacy as Partial<Settings>).localParserFallback;
    await db.settings.add(legacy as Settings);
    const stores = createStores(db);
    const settings = await stores.settings.get();
    expect(settings.localParserFallback).toBe(true);
  });
});

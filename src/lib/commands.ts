// DompetKu v1.0.2 — slash-command catalog for the chat composer.
// One source of truth: the names here must match parseCommand in
// parser.ts. The help reply is built from this list too, so the menu and
// /bantuan can never drift apart.

export interface ChatCommand {
  /** Without the slash, e.g. 'sisa'. */
  name: string;
  /** Text inserted when the user picks the command. A trailing space means
      the command takes arguments and the user keeps typing. */
  usage: string;
  /** One short line, shown under the name in the menu and in /bantuan. */
  description: string;
}

export const CHAT_COMMANDS: ChatCommand[] = [
  {
    name: 'catat',
    usage: '/catat ',
    description: 'Catat pengeluaran, contoh: makan siang 45rb',
  },
  {
    name: 'sisa',
    usage: '/sisa',
    description: 'Sisa anggaran bulan ini',
  },
  {
    name: 'keluar',
    usage: '/keluar',
    description: 'Pengeluaran hari ini, kemarin, minggu ini, atau bulan ini',
  },
  {
    name: 'anggaran',
    usage: '/anggaran ',
    description: 'Atur anggaran dompet, contoh: Makan 2 juta',
  },
  {
    name: 'peringatan',
    usage: '/peringatan ',
    description: 'Atur pengingat anggaran, contoh: 80%',
  },
  { name: 'dompet', usage: '/dompet', description: 'Lihat daftar dompet' },
  {
    name: 'bantuan',
    usage: '/bantuan',
    description: 'Tampilkan daftar perintah ini',
  },
];

/**
 * The command-name part the user is still typing, or null when the menu
 * stays shut: the input does not start with '/', or the command is already
 * chosen and the user is typing its arguments.
 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith('/')) return null;
  const rest = input.slice(1);
  if (rest.includes(' ')) return null;
  return rest;
}

/** Narrow the catalog to the typed query. Empty query shows everything. */
export function filterCommands(query: string): ChatCommand[] {
  const q = query.toLowerCase().trim();
  if (!q) return CHAT_COMMANDS;
  return CHAT_COMMANDS.filter((c) => {
    if (c.name.startsWith(q)) return true;
    // Match the start of any word in the description, so '/ang' finds
    // /anggaran and '/dompet' finds the commands that mention dompet.
    return c.description
      .toLowerCase()
      .split(/[\s,]+/)
      .some((word) => word.startsWith(q));
  });
}

import https from 'https';
import { prisma } from '../config/database.js';
import { ChronopostStatut } from '@prisma/client';

const CHRONOTRACE_URL = 'https://chronotrace.chronopost.fr/chronotrace/api/services/v2/predefinedSearch?language=fr_FR';
const ACCOUNT_ID = '75190903';
const AMAZING_EVENT_PATTERN = /AMAZING\s*EVENT/i;

export interface ChronotraceParcel {
  numeroColis: string;
  clientNom: string;
  clientVille: string;
  clientAdresse: string;
  statut: ChronopostStatut;
  dateDepart: Date | null;
  dateLivraisonReelle: Date | null;
  isRetour: boolean;
}

function parseCookies(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) result[k.trim()] = v.join('=').trim();
  }
  return result;
}

function cookieHeader(raw: string): string {
  const parsed = parseCookies(raw);
  return Object.entries(parsed)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function inferStatut(lt: any): ChronopostStatut {
  const status: string = (lt.chronotraceStatus || '').toUpperCase();
  const receiverName: string = (lt.receiver?.name || '').toUpperCase();
  const senderName: string = (lt.sender?.name || '').toUpperCase();

  const isRetourParcel = AMAZING_EVENT_PATTERN.test(receiverName);
  const isOutbound = AMAZING_EVENT_PATTERN.test(senderName) || (!isRetourParcel);

  switch (status) {
    case 'LIVRE':
      return isRetourParcel ? 'rentre' : 'livre';
    case 'NON_LIVRE':
      return isRetourParcel ? 'en_retour' : 'expedie';
    case 'LIVRAISON_DIFFEREE':
      return 'probleme';
    case 'EN_COURS':
      return isRetourParcel ? 'en_retour' : 'expedie';
    default:
      return 'expedie';
  }
}

function parseDate(val: string | number | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function extractClientNom(lt: any, isRetour: boolean): string {
  if (isRetour) {
    // Return parcel: Amazing Event is the receiver, client is the sender
    return lt.sender?.reference || lt.sender?.name || 'Inconnu';
  }
  // Outbound parcel: Amazing Event is the sender, client is the receiver
  return lt.sender?.reference || lt.receiver?.name || lt.sender?.name || 'Inconnu';
}

function parseLt(lt: any): ChronotraceParcel {
  const receiverName: string = (lt.receiver?.name || '').toUpperCase();
  const isRetour = AMAZING_EVENT_PATTERN.test(receiverName);
  const statut = inferStatut(lt);

  const clientNom = extractClientNom(lt, isRetour);
  const clientVille = isRetour
    ? (lt.sender?.city || '')
    : (lt.receiver?.city || '');
  const clientAdresse = isRetour
    ? (lt.sender?.zipCode || '')
    : (lt.receiver?.zipCode || '');

  const dateDepart = parseDate(lt.lastEventDate || lt.sendDate || null);
  const dateLivraisonReelle =
    statut === 'livre' || statut === 'rentre'
      ? parseDate(lt.lastEventDate)
      : null;

  return {
    numeroColis: lt.lt,
    clientNom,
    clientVille,
    clientAdresse,
    statut,
    dateDepart,
    dateLivraisonReelle,
    isRetour,
  };
}

async function httpPost(cookies: string, pageNumber: number, pageSize: number): Promise<any> {
  const body = JSON.stringify({
    accounts: [{ subAccounts: [], id: ACCOUNT_ID, label: '' }],
    pageNumber,
    pageSize,
    searchName: 'TOUS',
    sensDuTri: 'desc',
    triePar: 'date_evt',
  });

  const cookieStr = cookieHeader(cookies);

  return new Promise((resolve, reject) => {
    const url = new URL(CHRONOTRACE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': cookieStr,
        'Origin': 'https://chronotrace.chronopost.fr',
        'Referer': 'https://chronotrace.chronopost.fr/chronotrace/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Chronotrace HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Chronotrace invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function fetchAllParcels(): Promise<ChronotraceParcel[]> {
  const session = await prisma.chronotraceSession.findUnique({ where: { id: 'singleton' } });
  if (!session) {
    throw new Error('No Chronotrace session configured. Please update cookies via the UI.');
  }

  const result: ChronotraceParcel[] = [];
  let pageNumber = 0;
  const pageSize = 50;

  while (true) {
    const data = await httpPost(session.cookies, pageNumber, pageSize);

    const lts: any[] = data.lts || [];
    for (const lt of lts) {
      if (!lt.lt) continue;
      result.push(parseLt(lt));
    }

    const totalPage: number = data.totalPage ?? 1;
    if (pageNumber + 1 >= totalPage) break;
    pageNumber++;
  }

  return result;
}

export async function getSessionStatus(): Promise<{ configured: boolean; updatedAt: Date | null }> {
  const session = await prisma.chronotraceSession.findUnique({ where: { id: 'singleton' } });
  return { configured: !!session, updatedAt: session?.updatedAt ?? null };
}

export async function saveSession(cookies: string): Promise<void> {
  await prisma.chronotraceSession.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', cookies },
    update: { cookies },
  });
}

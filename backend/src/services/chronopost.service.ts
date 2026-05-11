import { request } from 'https';

const CHRONOPOST_HOST = 'ws.chronopost.fr';
const CHRONOPOST_PATH = '/tracking-cxf/TrackingServiceWS';
const CHRONOPOST_ACCOUNT = '15450704';
const CHRONOPOST_PASSWORD = 'Laurytal2!';

function soapPost(body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf-8');
    const options = {
      hostname: CHRONOPOST_HOST,
      path: CHRONOPOST_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': '""',
        'Content-Length': buf.byteLength,
      },
    };
    const req = request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Chronopost timeout')); });
    req.write(buf);
    req.end();
  });
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([^<]*)</(?:[^:>]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return (m && m[1] !== undefined) ? m[1].trim() : null;
}

function extractBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>(.*?)</(?:[^:>]+:)?${tag}>`, 'is');
  const m = xml.match(re);
  return (m && m[1] !== undefined) ? m[1] : null;
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>(.*?)</(?:[^:>]+:)?${tag}>`, 'gis');
  return [...xml.matchAll(re)].map(m => m[1] ?? '');
}

export interface ChronopostSignificantEvent {
  code: string;
  eventDate: string;
  eventLabel: string;
  officeLabel?: string;
  zipCode?: string;
}

export interface ChronopostSearchParcel {
  skybillNumber: string;
  dateDeposit?: string;
  recipientName?: string;
  recipientCity?: string;
  recipientZipCode?: string;
  recipientCountry?: string;
  shipperRef?: string;
  significantEvent?: ChronopostSignificantEvent;
}

export interface ChronopostEvent {
  code: string;
  libelle: string;
  date: string;
  site: string;
}

export interface ChronopostTrackingResult {
  errorCode: string;
  errorMessage: string;
  skybillNumber?: string;
  recipientName?: string;
  recipientCity?: string;
  events: ChronopostEvent[];
}

// Fetch all parcels for the account within a date range
export async function searchByAccount(
  dateDeposit: string,
  dateEndDeposit: string,
): Promise<{ errorCode: string; errorMessage: string; parcels: ChronopostSearchParcel[] }> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cxf="http://cxf.tracking.soap.chronopost.fr/">
  <soapenv:Header/>
  <soapenv:Body>
    <cxf:trackSearch>
      <accountNumber>${CHRONOPOST_ACCOUNT}</accountNumber>
      <password>${CHRONOPOST_PASSWORD}</password>
      <language>fr_FR</language>
      <dateDeposit>${dateDeposit}</dateDeposit>
      <dateEndDeposit>${dateEndDeposit}</dateEndDeposit>
    </cxf:trackSearch>
  </soapenv:Body>
</soapenv:Envelope>`;

  const xml = await soapPost(body);
  const errorCode = extractTag(xml, 'errorCode') ?? '0';
  const errorMessage = extractTag(xml, 'errorMessage') ?? '';

  const parcels: ChronopostSearchParcel[] = [];

  for (const block of extractAllBlocks(xml, 'listInfosPOD')) {
    const skybillNumber = extractTag(block, 'skybillNumber');
    if (!skybillNumber) continue;

    const evBlock = extractBlock(block, 'significantEvent');
    const significantEvent: ChronopostSignificantEvent | undefined = evBlock ? {
      code: extractTag(evBlock, 'code') ?? '',
      eventDate: extractTag(evBlock, 'eventDate') ?? '',
      eventLabel: extractTag(evBlock, 'eventLabel') ?? '',
      officeLabel: extractTag(evBlock, 'officeLabel') ?? undefined,
      zipCode: extractTag(evBlock, 'zipCode') ?? undefined,
    } : undefined;

    parcels.push({
      skybillNumber,
      dateDeposit: extractTag(block, 'dateDeposit') ?? undefined,
      recipientName: extractTag(block, 'recipientName') ?? undefined,
      recipientCity: extractTag(block, 'recipientCity') ?? undefined,
      recipientZipCode: extractTag(block, 'recipientZipCode') ?? undefined,
      recipientCountry: extractTag(block, 'recipientCountry') ?? undefined,
      shipperRef: extractTag(block, 'shipperRef') ?? undefined,
      significantEvent,
    });
  }

  return { errorCode, errorMessage, parcels };
}

// Get full tracking history for a single parcel
export async function trackParcel(numeroColis: string): Promise<ChronopostTrackingResult> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cxf="http://cxf.tracking.soap.chronopost.fr/">
  <soapenv:Header/>
  <soapenv:Body>
    <cxf:trackSkybillV2>
      <skybillNumber>${numeroColis}</skybillNumber>
      <language>fr_FR</language>
    </cxf:trackSkybillV2>
  </soapenv:Body>
</soapenv:Envelope>`;

  const xml = await soapPost(body);
  const errorCode = extractTag(xml, 'errorCode') ?? '0';
  const errorMessage = extractTag(xml, 'errorMessage') ?? '';

  const events: ChronopostEvent[] = extractAllBlocks(xml, 'listEventInfoComp').map(block => ({
    code: extractTag(block, 'code') ?? '',
    libelle: extractTag(block, 'eventLabel') ?? '',
    date: extractTag(block, 'eventDate') ?? '',
    site: extractTag(block, 'officeLabel') ?? '',
  }));

  return {
    errorCode,
    errorMessage,
    skybillNumber: extractTag(xml, 'skybillNumber') ?? undefined,
    recipientName: extractTag(xml, 'recipientName') ?? undefined,
    recipientCity: extractTag(xml, 'recipientCity') ?? undefined,
    events,
  };
}

export function inferStatutFromSignificantEvent(event?: ChronopostSignificantEvent): string {
  if (!event) return 'expedie';
  const label = (event.eventLabel ?? '').toLowerCase();
  const code = (event.code ?? '').toUpperCase();
  if (label.includes('livr') || code === 'LD' || code === 'D1') return 'livre';
  if (label.includes('retour') || code === 'RI' || code === 'RET') return 'en_retour';
  if (label.includes('absent') || label.includes('avis de passage') || code === 'AM') return 'probleme';
  return 'expedie';
}

import axios from 'axios';

const CHRONOPOST_ENDPOINT = 'https://ws.chronopost.fr/tracking-cxf/TrackingServiceWS';

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([^<]*)</(?:[^:>]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m && m[1] !== undefined ? m[1].trim() : null;
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>(.*?)</(?:[^:>]+:)?${tag}>`, 'gis');
  return [...xml.matchAll(re)].map(m => m[1] ?? '');
}

export interface ChronopostEvent {
  code: string;
  libelle: string;
  date: string;
  site: string;
  dest?: string;
}

export interface ChronopostTrackingResult {
  errorCode: string;
  errorMessage: string;
  skybillNumber?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientCity?: string;
  statusInfo?: string;
  deliveryDate?: string;
  events: ChronopostEvent[];
}

export async function trackParcel(numeroColis: string): Promise<ChronopostTrackingResult> {
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cxf="http://cxf.tracking.soap.chronopost.fr/">
  <soapenv:Header/>
  <soapenv:Body>
    <cxf:trackParcelV2>
      <skybillNumber>${numeroColis}</skybillNumber>
      <language>fr_FR</language>
    </cxf:trackParcelV2>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await axios.post(CHRONOPOST_ENDPOINT, soapBody, {
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      'SOAPAction': '""',
    },
    timeout: 10000,
  });

  const xml: string = response.data;

  const errorCode = extractTag(xml, 'errorCode') ?? '0';
  const errorMessage = extractTag(xml, 'errorMessage') ?? '';

  const eventBlocks = extractAllBlocks(xml, 'listEventInfoComp');
  const events: ChronopostEvent[] = eventBlocks.map(block => ({
    code: extractTag(block, 'code') ?? '',
    libelle: extractTag(block, 'libelle') ?? '',
    date: extractTag(block, 'date') ?? '',
    site: extractTag(block, 'site') ?? '',
    dest: extractTag(block, 'dest') ?? undefined,
  }));

  return {
    errorCode,
    errorMessage,
    skybillNumber: extractTag(xml, 'skybillNumber') ?? undefined,
    recipientName: extractTag(xml, 'recipientName') ?? undefined,
    recipientAddress: extractTag(xml, 'recipientAddress1') ?? undefined,
    recipientCity: extractTag(xml, 'recipientCity') ?? undefined,
    statusInfo: extractTag(xml, 'statusInfo') ?? undefined,
    deliveryDate: extractTag(xml, 'deliveryDate') ?? undefined,
    events,
  };
}

export function inferStatutFromTracking(result: ChronopostTrackingResult): string {
  if (result.errorCode !== '0') return 'probleme';
  const lastEvent = result.events[result.events.length - 1];
  if (!lastEvent) return 'en_preparation';
  const code = lastEvent.code?.toUpperCase();
  if (code === 'L' || code === 'LI' || result.statusInfo?.toLowerCase().includes('livr')) return 'livre';
  if (code === 'D' || result.events.length > 0) return 'expedie';
  return 'en_preparation';
}

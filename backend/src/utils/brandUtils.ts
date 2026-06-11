/**
 * Résout la marque d'un booking : senderBrand (marque d'envoi explicite),
 * sinon repli sur crmBrand (origine CRM, en minuscules), sinon SHOOTNBOX.
 * Le repli crmBrand couvre les bookings dont l'email a été envoyé avant
 * que senderBrand ne soit persisté (ex: anciens envois "Avis Mail").
 */
export function resolveBookingBrand(booking: {
  senderBrand?: string | null;
  crmBrand?: string | null;
}): 'SHOOTNBOX' | 'SMAKK' {
  if (booking.senderBrand === 'SMAKK') return 'SMAKK';
  if (booking.senderBrand === 'SHOOTNBOX') return 'SHOOTNBOX';
  return booking.crmBrand?.toLowerCase() === 'smakk' ? 'SMAKK' : 'SHOOTNBOX';
}

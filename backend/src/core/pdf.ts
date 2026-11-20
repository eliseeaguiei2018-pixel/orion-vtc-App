/**
 * Générateur PDF 1.4 minimal SANS dépendance (une page A4, Helvetica).
 * Utilisé par les rapports « un clic » de la console : réquisition SAMU,
 * fiche qualité chauffeur, configuration dispatch, rapport ESG entreprise…
 * Les diacritiques sont retirés (police Type1 de base sans encodage étendu).
 */
export function simplePdf(lines: string[]): Buffer {
  const ascii = (s: string) => s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[—–]/g, '-');
  const esc = (s: string) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rows = lines.slice(0, 46); // une page (interligne 16 pt)
  const content = ['BT /F1 11 Tf 50 790 Td 16 TL', ...rows.map((l, i) => `${i === 0 ? '' : 'T* '}(${esc(l)}) Tj`), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

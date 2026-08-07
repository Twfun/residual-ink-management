export type Lab = { l: number; a: number; b: number };

// CIE Lab (D50/2°, as reported by print instruments such as X-Rite eXact)
// converted to sRGB. Adaptation D50 -> D65 uses white-point scaling so the
// industry-published Lab(D50) values of the sRGB primaries round-trip exactly
// (e.g. red = L53.24 a80.09 b67.20). Out-of-gamut values are clamped and
// flagged with inGamut = false.
const D50 = { x: 0.9642, y: 1, z: 0.8251 };
const D65 = { x: 0.95047, y: 1, z: 1.08883 };
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export function labToRgb(l: number, a: number, b: number) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xr = fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const yr = l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA;
  const zr = fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA;
  const x = xr * D50.x;
  const y = yr * D50.y;
  const z = zr * D50.z;
  // white-point scaling D50 -> D65
  const xa = (x * D65.x) / D50.x;
  const ya = (y * D65.y) / D50.y;
  const za = (z * D65.z) / D50.z;
  // XYZ (D65) -> linear sRGB
  const rLinear = 3.2404542 * xa - 1.5371385 * ya - 0.4985314 * za;
  const gLinear = -0.969266 * xa + 1.8760108 * ya + 0.041556 * za;
  const bLinear = 0.0556434 * xa - 0.2040259 * ya + 1.0572252 * za;
  const inGamut = [rLinear, gLinear, bLinear].every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
  const encode = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };
  return { r: encode(rLinear), g: encode(gLinear), b: encode(bLinear), inGamut };
}

export function labToCss(lab: Lab) {
  const { r, g, b } = labToRgb(lab.l, lab.a, lab.b);
  return `rgb(${r}, ${g}, ${b})`;
}

export function extractMeasuredLab(response: any): Lab | null {
  const candidate = response?.measurement?.lab?.M0 ?? response?.measurement?.Lab ?? response?.lab;
  if (candidate && typeof candidate === 'object') {
    const l = Number(candidate.L ?? candidate.l ?? candidate.lStar);
    const a = Number(candidate.a ?? candidate.aStar);
    const b = Number(candidate.b ?? candidate.bStar);
    if ([l, a, b].every(Number.isFinite)) return { l, a, b };
  }
  if (typeof candidate === 'string') {
    const values = candidate.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite)) {
      return { l: values[0], a: values[1], b: values[2] };
    }
  }
  return null;
}

export type XriteMeasurement = Lab & {
  densityT: number | null;
  measureCondition: string | null;
  instrumentModel: string | null;
  instrumentSerial: string | null;
  raw: unknown;
};

function pickText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

export function parseXriteMeasurement(response: any): XriteMeasurement | null {
  const lab = extractMeasuredLab(response);
  if (!lab) return null;
  const instrument = response?.instrument ?? response?.device ?? {};
  const densityCandidate = response?.measurement?.density?.T ?? response?.measurement?.densityT ?? response?.densityT;
  const densityT =
    Number.isFinite(Number(densityCandidate)) &&
    densityCandidate !== null &&
    densityCandidate !== undefined &&
    densityCandidate !== ''
      ? Number(densityCandidate)
      : null;
  return {
    ...lab,
    densityT,
    measureCondition: pickText(response?.measurement?.condition, response?.measureCondition, response?.condition),
    instrumentModel: pickText(instrument.model, response?.model),
    instrumentSerial: pickText(instrument.serial, instrument.serialNumber, response?.serial),
    raw: response,
  };
}

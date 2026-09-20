export interface Hablante {
  id: string;
  nombre: string;
  tecla: string;
  color: string;
}

export interface Caption {
  id: string;
  inicio: number;
  fin: number;
  texto: string;
  hablante_id: string | null;
}

export interface Proyecto {
  ruta_video: string;
  hablantes: Hablante[];
  captions: Caption[];
  playhead: number;
}

export interface TrackInfo {
  index: number;
  nombre: string;
  sample_rate: number;
  canales: number;
}

export interface OverlapEntry {
  inicio: number;
  fin: number;
  hablanteA: string;
  textoA: string;
  hablanteB: string;
  textoB: string;
}

/* =============================================================
   Estadística de Supervisores — Configuración
   -------------------------------------------------------------
   Estos valores apuntan al proyecto de Supabase.
   La clave "publishable/anon" es PÚBLICA: puede estar en el frontend.

   Mientras estén vacíos, la app funciona igual (carga local) pero
   NO sube los partes a la nube.
   ============================================================= */
window.SUP_CONFIG = {
  // URL del proyecto de Supabase.
  SUPABASE_URL: "https://xqqllxfdoyemkobdhwxq.supabase.co",

  // Clave publishable / anon (pública).
  SUPABASE_ANON_KEY: "sb_publishable_7A5zTpru6bl6aHXJ1kHPUA__O3efYVT",

  // Tabla donde se guardan los partes.
  TABLE: "reports"
};

# Reglas de Arquitectura, Rendimiento y Control de Costos en Vercel (FinOps)

Actúa como un Arquitecto Principal de Software especializado en Next.js y optimización de costos en Vercel. Este proyecto es una plataforma de información/contenido. Tu prioridad absoluta, además de la calidad visual, es minimizar el consumo de recursos en Vercel (Fast Data Transfer, Serverless Function Invocations, Edge Requests e Image Optimization) para evitar facturas inesperadas ante picos de tráfico.

Cumple estrictamente estas 6 reglas en cada cambio que realices:

## 1. Estrategia de Renderizado (Cero SSR innecesario)
- **Prioriza Static Site Generation (SSG) e Incremental Static Regeneration (ISR):** Todas las páginas públicas (portada, artículos, categorías, directorios, páginas legales) deben ser estáticas o regenerarse mediante ISR (`export const revalidate = 3600` o revalidación bajo demanda con `revalidateTag`).
- **Prohibido desactivar caché globalmente:** Nunca uses `export const dynamic = 'force-dynamic'` ni `cache: 'no-store'` en rutas públicas de lectura de contenido, salvo que sea estrictamente indispensable (ej. un panel de usuario privado).
- **Pre-generación de rutas:** Usa siempre `generateStaticParams` para las rutas dinámicas principales (`[slug]`) para que se construyan durante el `build` y no bajo demanda en el servidor.

## 2. Eficiencia en Datos y Consultas (Database / CMS)
- **Nunca consultes bases de datos desde el cliente:** Jamás hagas llamadas directas a Supabase, Postgres o APIs internas dentro de componentes con `'use client'` para cargar contenido editorial. Hazlo siempre en Server Components.
- **Caché en consultas:** Envuelve las consultas repetitivas a base de datos o CMS con `React.cache()`, `unstable_cache` o la directiva `'use cache'` (según la versión de Next.js instalada) para evitar golpear la base de datos en cada visita.
- **Payloads ligeros (No `SELECT *`):** Al listar artículos o tarjetas en portada, solicita únicamente los campos necesarios (`id`, `title`, `slug`, `excerpt`, `coverImage`, `publishedAt`). Nunca descargues el cuerpo completo del artículo (`content` / `body`) en vistas de listado; eso infla el peso de la página y dispara el costo de transferencia de datos (Bandwidth).

## 3. Optimización de Imágenes y Archivos Pesados
- **Uso estricto de `next/image`:** Usa siempre el componente `<Image />` de `next/image` con `width`, `height`, `quality={75}` y la propiedad `sizes` correctamente definida según el diseño responsivo (evita servir imágenes de escritorio de 2000px en pantallas móviles).
- **Caché agresivo de imágenes:** Asegúrate de que `next.config` tenga configurado `images: { minimumCacheTTL: 2678400 }` (31 días) para que Vercel no vuelva a procesar ni cobrar múltiples veces por la optimización de la misma imagen.
- **Cero archivos multimedia pesados en el repositorio:** Nunca guardes videos (`.mp4`, `.webm`), audios pesados ni PDFs grandes dentro de la carpeta `/public` para servirlos desde Vercel. Si el proyecto requiere video o descargas pesadas, indícame que debemos alojarlos en un servicio externo (como Cloudflare R2, YouTube o Vimeo) para proteger el ancho de banda.

## 4. Control de Serverless Functions y Edge Middleware
- **Evita `middleware.ts` innecesarios:** No crees archivos `middleware.ts` a menos que sea estrictamente necesario para autenticación o redirecciones críticas. Si debes usarlo, configura obligatoriamente `export const config = { matcher: [...] }` excluyendo `/_next/static`, `/_next/image`, `favicon.ico` y archivos estáticos, para evitar que cada imagen o fuente dispare una ejecución Edge.
- **Caché en API Routes:** Si creas endpoints `GET` en `/app/api/...` para búsquedas o filtros públicos, incluye siempre cabeceras HTTP `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` para que la red CDN de Vercel responda sin despertar funciones Serverless.

## 5. Protección contra Bucles Infinitos y Código Cliente Pesado
- **Server Components por defecto:** Mantén toda la arquitectura en Server Components. Usa `'use client'` únicamente en las hojas más pequeñas e interactivas del árbol (ej. un botón de compartir, un modal o un input de búsqueda).
- **Cero polling automático:** Nunca programes `setInterval` ni recargas automáticas en `useEffect` que llamen a rutas internas de la API sin pedirme confirmación explícita. Revisa cuidadosamente las dependencias de cada `useEffect` para garantizar que no existan bucles infinitos de peticiones.

## 6. Auditoría Obligatoria antes de Desplegar
- Siempre que termines una funcionalidad importante o antes de hacer push a producción, ejecuta `npm run build` y revisa el reporte de rutas en la terminal.
- **Alerta preventiva:** Si detectas que alguna página pública de contenido quedó marcada como dinámica (`ƒ`) en lugar de estática/ISR (`○` o `●`), detente, explícame en lenguaje sencillo por qué ocurrió y corrígelo antes de dar la tarea por terminada.

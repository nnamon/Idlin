//! Map preview: rasterize a zone's authored map to a PNG so an author can
//! SEE a `map.txt` without booting the server — ground palette
//! (variant-aware), elevation banding, props, the BFS-reachable region
//! (unreachable pockets washed red), and spawn / pack / exit / gate
//! markers.
//!
//! ```text
//! cargo run -p idlin-content --bin preview -- coast
//! cargo run -p idlin-content --bin preview -- coast out.png --cell 16
//! ```
//!
//! Pure CPU, no GPU, no image-crate dependency — a tiny hand-rolled PNG
//! encoder (uncompressed DEFLATE) writes the file. Output defaults under
//! `target/preview/` so a render never lands as an accidental commit.

use idlin_content::{ContentDb, TilesetDef, ZoneDef};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const CELL_DEFAULT: i32 = 12;

fn main() -> ExitCode {
    let mut zone_id: Option<String> = None;
    let mut out: Option<String> = None;
    let mut content_dir = "content".to_string();
    let mut cell = CELL_DEFAULT;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--content" => content_dir = args.next().unwrap_or(content_dir),
            "--cell" => {
                cell = args
                    .next()
                    .and_then(|s| s.parse().ok())
                    .filter(|n| *n >= 1 && *n <= 64)
                    .unwrap_or(CELL_DEFAULT)
            }
            other if zone_id.is_none() => zone_id = Some(other.to_string()),
            other if out.is_none() => out = Some(other.to_string()),
            other => {
                eprintln!("error: unexpected argument `{other}`");
                return ExitCode::from(1);
            }
        }
    }
    let Some(zone_id) = zone_id else {
        eprintln!("usage: preview <zone_id> [out.png] [--content DIR] [--cell N]");
        return ExitCode::from(1);
    };

    if !Path::new(&content_dir).exists() {
        eprintln!("error: content directory `{content_dir}` does not exist");
        return ExitCode::from(1);
    }
    let db = match ContentDb::load(Path::new(&content_dir)) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("error loading content: {e}");
            return ExitCode::from(1);
        }
    };
    let Some(zone) = db.zone(&zone_id) else {
        let ids: Vec<&str> = db.zones.iter().map(|z| z.id.as_str()).collect();
        eprintln!(
            "error: no zone `{zone_id}`. known zones: {}",
            ids.join(", ")
        );
        return ExitCode::from(1);
    };
    let Some(ts) = zone.tileset.as_deref().and_then(|t| db.tileset(t)) else {
        eprintln!("error: zone `{zone_id}` has no tileset/map.txt to preview");
        return ExitCode::from(1);
    };
    if zone.tiles.is_none() {
        eprintln!("error: zone `{zone_id}` has no attached map grid");
        return ExitCode::from(1);
    }

    let (canvas, unreachable) = render(zone, ts, cell);

    let out_path: PathBuf = match out {
        Some(p) => PathBuf::from(p),
        None => {
            let dir = Path::new("target").join("preview");
            let _ = std::fs::create_dir_all(&dir);
            dir.join(format!("{zone_id}.png"))
        }
    };
    let bytes = png::encode_rgb(canvas.w as u32, canvas.h as u32, &canvas.px);
    if let Err(e) = std::fs::write(&out_path, &bytes) {
        eprintln!("error writing {}: {e}", out_path.display());
        return ExitCode::from(1);
    }
    println!(
        "wrote {} ({}×{} px, cell {})",
        out_path.display(),
        canvas.w,
        canvas.h,
        cell
    );
    println!("legend: green=spawn  orange=pack  cyan=exit  magenta=gate  red wash=unreachable");
    if unreachable > 0 {
        println!("WARNING: {unreachable} walkable cell(s) are UNREACHABLE from spawn (red wash)");
    }
    ExitCode::SUCCESS
}

// ----------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------

fn render(zone: &ZoneDef, ts: &TilesetDef, cell: i32) -> (Canvas, usize) {
    let grid = zone.tiles.as_ref().expect("caller checked tiles present");
    let variant = zone
        .tileset_variant
        .as_deref()
        .and_then(|v| ts.variants.iter().find(|var| var.id == v));
    let color_for_ground = |g: &str| -> Rgb {
        if let Some(var) = variant
            && let Some((_, hex)) = var.palette.iter().find(|(k, _)| k == g)
        {
            return parse_hex(hex);
        }
        if let Some((_, hex)) = ts.palette.iter().find(|(k, _)| k == g) {
            return parse_hex(hex);
        }
        [128, 128, 128]
    };
    let walkable_at = |x: i32, y: i32| -> bool {
        grid.cell(x, y)
            .is_some_and(|c| ts.tiles[c as usize].walkable)
    };

    let mut c = Canvas::new(grid.width * cell, grid.height * cell);

    // -- tiles: ground color, elevation band, non-walkable darkening, prop --
    for ty in 0..grid.height {
        for tx in 0..grid.width {
            let Some(cidx) = grid.cell(tx, ty) else {
                continue;
            };
            let t = &ts.tiles[cidx as usize];
            let mut col = shade(color_for_ground(&t.ground), t.elevation);
            if !t.walkable {
                col = scale(col, 65); // darken walls/water to read as solid
            }
            c.fill_rect(tx * cell, ty * cell, cell, cell, col);
            if !t.walkable {
                c.rect_outline(tx * cell, ty * cell, cell, cell, scale(col, 70));
            }
            if t.prop.is_some() {
                c.dot(
                    tx * cell + cell / 2,
                    ty * cell + cell / 2,
                    cell / 4,
                    [30, 24, 18],
                );
            }
        }
    }

    // -- reachability: flood from spawn over walkable cells; wash the rest --
    let w = grid.width;
    let h = grid.height;
    let mut seen = vec![false; (w * h).max(0) as usize];
    let in_bounds = |x: i32, y: i32| x >= 0 && y >= 0 && x < w && y < h;
    if in_bounds(zone.spawn_x_u, zone.spawn_y_u) && walkable_at(zone.spawn_x_u, zone.spawn_y_u) {
        let mut q = VecDeque::new();
        seen[(zone.spawn_y_u * w + zone.spawn_x_u) as usize] = true;
        q.push_back((zone.spawn_x_u, zone.spawn_y_u));
        while let Some((x, y)) = q.pop_front() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (x + dx, y + dy);
                if in_bounds(nx, ny) {
                    let i = (ny * w + nx) as usize;
                    if !seen[i] && walkable_at(nx, ny) {
                        seen[i] = true;
                        q.push_back((nx, ny));
                    }
                }
            }
        }
    }
    let mut unreachable = 0usize;
    for ty in 0..h {
        for tx in 0..w {
            if walkable_at(tx, ty) && !seen[(ty * w + tx) as usize] {
                unreachable += 1;
                c.wash_rect(tx * cell, ty * cell, cell, cell, [220, 40, 40]);
            }
        }
    }

    // -- a faint grid every 5 cells for coordinate reading --
    let mut gx = 0;
    while gx <= grid.width {
        c.vline(gx * cell, 0, grid.height * cell, [0, 0, 0], 36);
        gx += 5;
    }
    let mut gy = 0;
    while gy <= grid.height {
        c.hline(gy * cell, 0, grid.width * cell, [0, 0, 0], 36);
        gy += 5;
    }

    let center = |ux: i32, uy: i32| (ux * cell + cell / 2, uy * cell + cell / 2);

    // -- spawn (green) --
    let (sx, sy) = center(zone.spawn_x_u, zone.spawn_y_u);
    c.circle(sx, sy, zone.spawn_radius_u.max(0) * cell, [60, 220, 90]);
    c.dot(sx, sy, (cell / 3).max(2), [60, 220, 90]);
    c.text(sx + 3, sy + 3, "spawn", [60, 220, 90]);

    // -- packs (orange) --
    for p in &zone.packs {
        let (px, py) = center(p.x_u, p.y_u);
        c.circle(px, py, p.radius_u.max(0) * cell, [240, 150, 40]);
        c.dot(px, py, (cell / 3).max(2), [240, 150, 40]);
        c.text(
            px + 3,
            py + 3,
            &format!("{}x{}", p.monster, p.count),
            [240, 150, 40],
        );
    }

    // -- exits (cyan; brighter ring if open) --
    for e in &zone.exits {
        let (ex, ey) = center(e.x_u, e.y_u);
        let ink = if e.open {
            [90, 230, 230]
        } else {
            [40, 140, 150]
        };
        c.dot(ex, ey, (cell / 3).max(2), ink);
        c.circle(ex, ey, cell, ink);
        c.text(ex + 3, ey + 3, &format!(">{}", e.dest), ink);
    }

    // -- gates (magenta rectangles) --
    for g in &zone.gates {
        let x0 = g.x0.min(g.x1) * cell;
        let y0 = g.y0.min(g.y1) * cell;
        let gw = (g.x1 - g.x0).abs() * cell + cell;
        let gh = (g.y1 - g.y0).abs() * cell + cell;
        let ink = if g.open {
            [220, 120, 220]
        } else {
            [180, 60, 180]
        };
        c.rect_outline(x0, y0, gw, gh, ink);
        if !g.id.is_empty() {
            c.text(x0 + 2, y0 + 2, &g.id, ink);
        }
    }

    (c, unreachable)
}

type Rgb = [u8; 3];

fn parse_hex(s: &str) -> Rgb {
    let s = s.trim_start_matches('#');
    let byte = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("80"), 16).unwrap_or(128);
    if s.len() >= 6 {
        [byte(0), byte(2), byte(4)]
    } else {
        [128, 128, 128]
    }
}

/// Scale every channel by `pct`/100, clamped.
fn scale(c: Rgb, pct: i32) -> Rgb {
    let ch = |v: u8| ((v as i32 * pct) / 100).clamp(0, 255) as u8;
    [ch(c[0]), ch(c[1]), ch(c[2])]
}

/// Lighten by elevation so terraces read as bands (0 = unchanged).
fn shade(c: Rgb, elevation: u8) -> Rgb {
    scale(c, 100 + (elevation as i32) * 12)
}

// ----------------------------------------------------------------------
// Canvas — a plain RGB framebuffer with bounds-safe primitives.
// ----------------------------------------------------------------------

struct Canvas {
    w: i32,
    h: i32,
    px: Vec<u8>,
}

impl Canvas {
    fn new(w: i32, h: i32) -> Canvas {
        let (w, h) = (w.max(1), h.max(1));
        Canvas {
            w,
            h,
            px: vec![0u8; (w * h * 3) as usize],
        }
    }

    fn put(&mut self, x: i32, y: i32, c: Rgb) {
        if x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = ((y * self.w + x) * 3) as usize;
        self.px[i] = c[0];
        self.px[i + 1] = c[1];
        self.px[i + 2] = c[2];
    }

    /// Alpha-blend `c` over the pixel at `alpha`/255.
    fn blend(&mut self, x: i32, y: i32, c: Rgb, alpha: u8) {
        if x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = ((y * self.w + x) * 3) as usize;
        let a = alpha as u32;
        for (k, &cv) in c.iter().enumerate() {
            let dst = self.px[i + k] as u32;
            self.px[i + k] = ((cv as u32 * a + dst * (255 - a)) / 255) as u8;
        }
    }

    fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: Rgb) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.put(xx, yy, c);
            }
        }
    }

    fn wash_rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: Rgb) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.blend(xx, yy, c, 120);
            }
        }
    }

    fn rect_outline(&mut self, x: i32, y: i32, w: i32, h: i32, c: Rgb) {
        self.hline(y, x, x + w, c, 255);
        self.hline(y + h - 1, x, x + w, c, 255);
        self.vline(x, y, y + h, c, 255);
        self.vline(x + w - 1, y, y + h, c, 255);
    }

    fn hline(&mut self, y: i32, x0: i32, x1: i32, c: Rgb, alpha: u8) {
        for x in x0..x1 {
            self.blend(x, y, c, alpha);
        }
    }

    fn vline(&mut self, x: i32, y0: i32, y1: i32, c: Rgb, alpha: u8) {
        for y in y0..y1 {
            self.blend(x, y, c, alpha);
        }
    }

    fn dot(&mut self, cx: i32, cy: i32, r: i32, c: Rgb) {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r * r {
                    self.put(cx + dx, cy + dy, c);
                }
            }
        }
    }

    /// A 1px circle outline (integer midpoint algorithm).
    fn circle(&mut self, cx: i32, cy: i32, r: i32, c: Rgb) {
        if r <= 0 {
            return;
        }
        let (mut x, mut y) = (r, 0);
        let mut err = 1 - r;
        while x >= y {
            for (px, py) in [
                (cx + x, cy + y),
                (cx + y, cy + x),
                (cx - y, cy + x),
                (cx - x, cy + y),
                (cx - x, cy - y),
                (cx - y, cy - x),
                (cx + y, cy - x),
                (cx + x, cy - y),
            ] {
                self.put(px, py, c);
            }
            y += 1;
            if err < 0 {
                err += 2 * y + 1;
            } else {
                x -= 1;
                err += 2 * (y - x) + 1;
            }
        }
    }

    /// Render a short string with the tiny 3×5 font, 1px scale, +1px spacing.
    fn text(&mut self, x: i32, y: i32, s: &str, c: Rgb) {
        let mut cx = x;
        for ch in s.chars() {
            let g = font::glyph(ch);
            for (row, bits) in g.iter().enumerate() {
                for col in 0..3 {
                    if bits & (1 << (2 - col)) != 0 {
                        self.put(cx + col, y + row as i32, c);
                    }
                }
            }
            cx += 4;
        }
    }
}

// ----------------------------------------------------------------------
// A tiny 3×5 bitmap font (ASCII subset). Each glyph is 5 rows; the low 3
// bits of each row are the pixels (MSB = left). Unknown chars are blank.
// ----------------------------------------------------------------------
mod font {
    pub fn glyph(c: char) -> [u8; 5] {
        match c.to_ascii_lowercase() {
            '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
            '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
            '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
            '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
            '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
            '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
            '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
            '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
            '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
            '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
            'a' => [0b010, 0b101, 0b111, 0b101, 0b101],
            'b' => [0b110, 0b101, 0b110, 0b101, 0b110],
            'c' => [0b011, 0b100, 0b100, 0b100, 0b011],
            'd' => [0b110, 0b101, 0b101, 0b101, 0b110],
            'e' => [0b111, 0b100, 0b110, 0b100, 0b111],
            'f' => [0b111, 0b100, 0b110, 0b100, 0b100],
            'g' => [0b011, 0b100, 0b101, 0b101, 0b011],
            'h' => [0b101, 0b101, 0b111, 0b101, 0b101],
            'i' => [0b111, 0b010, 0b010, 0b010, 0b111],
            'j' => [0b001, 0b001, 0b001, 0b101, 0b010],
            'k' => [0b101, 0b101, 0b110, 0b101, 0b101],
            'l' => [0b100, 0b100, 0b100, 0b100, 0b111],
            'm' => [0b101, 0b111, 0b111, 0b101, 0b101],
            'n' => [0b101, 0b111, 0b111, 0b111, 0b101],
            'o' => [0b010, 0b101, 0b101, 0b101, 0b010],
            'p' => [0b110, 0b101, 0b110, 0b100, 0b100],
            'q' => [0b010, 0b101, 0b101, 0b011, 0b001],
            'r' => [0b110, 0b101, 0b110, 0b101, 0b101],
            's' => [0b011, 0b100, 0b010, 0b001, 0b110],
            't' => [0b111, 0b010, 0b010, 0b010, 0b010],
            'u' => [0b101, 0b101, 0b101, 0b101, 0b111],
            'v' => [0b101, 0b101, 0b101, 0b101, 0b010],
            'w' => [0b101, 0b101, 0b111, 0b111, 0b101],
            'x' => [0b101, 0b101, 0b010, 0b101, 0b101],
            'y' => [0b101, 0b101, 0b010, 0b010, 0b010],
            'z' => [0b111, 0b001, 0b010, 0b100, 0b111],
            '_' => [0b000, 0b000, 0b000, 0b000, 0b111],
            '-' => [0b000, 0b000, 0b111, 0b000, 0b000],
            '.' => [0b000, 0b000, 0b000, 0b000, 0b010],
            ':' => [0b000, 0b010, 0b000, 0b010, 0b000],
            '>' => [0b100, 0b010, 0b001, 0b010, 0b100],
            _ => [0, 0, 0, 0, 0],
        }
    }
}

// ----------------------------------------------------------------------
// A minimal, dependency-free PNG encoder: 8-bit RGB, a zlib stream of
// STORED (uncompressed) DEFLATE blocks. Trivial and deterministic.
// ----------------------------------------------------------------------
mod png {
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc: u32 = 0xFFFF_FFFF;
        for &b in bytes {
            crc ^= b as u32;
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
            }
        }
        !crc
    }

    fn adler32(bytes: &[u8]) -> u32 {
        let (mut a, mut b): (u32, u32) = (1, 0);
        for &byte in bytes {
            a = (a + byte as u32) % 65521;
            b = (b + a) % 65521;
        }
        (b << 16) | a
    }

    /// Wrap raw bytes in a zlib stream of STORED DEFLATE blocks.
    fn zlib_store(raw: &[u8]) -> Vec<u8> {
        let mut out = vec![0x78, 0x01]; // CM=8, no preset dict, low level
        let mut i = 0;
        if raw.is_empty() {
            out.extend_from_slice(&[0x01, 0x00, 0x00, 0xFF, 0xFF]);
        }
        while i < raw.len() {
            let len = (raw.len() - i).min(0xFFFF);
            let final_block = i + len >= raw.len();
            out.push(if final_block { 1 } else { 0 }); // BFINAL, BTYPE=00
            out.extend_from_slice(&(len as u16).to_le_bytes());
            out.extend_from_slice(&(!(len as u16)).to_le_bytes());
            out.extend_from_slice(&raw[i..i + len]);
            i += len;
        }
        out.extend_from_slice(&adler32(raw).to_be_bytes());
        out
    }

    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        let crc = crc32(&out[start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    }

    /// Encode an 8-bit RGB image (`px` is row-major `w*h*3` bytes).
    pub fn encode_rgb(w: u32, h: u32, px: &[u8]) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

        let mut ihdr = Vec::with_capacity(13);
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]); // depth 8, color 2 (RGB)
        chunk(&mut out, b"IHDR", &ihdr);

        // Filtered scanlines: a 0 (None) filter byte per row, then RGB.
        let stride = (w * 3) as usize;
        let mut raw = Vec::with_capacity((h as usize) * (stride + 1));
        for row in 0..h as usize {
            raw.push(0);
            raw.extend_from_slice(&px[row * stride..row * stride + stride]);
        }
        chunk(&mut out, b"IDAT", &zlib_store(&raw));
        chunk(&mut out, b"IEND", &[]);
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn crc_and_adler_known_vectors() {
            // CRC32 of "123456789" is the canonical 0xCBF43926.
            assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
            // Adler32 of "Wikipedia" is the documented 0x11E60398.
            assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
        }

        #[test]
        fn encodes_a_valid_png_skeleton() {
            // 2×2 solid image.
            let px = vec![255u8; 2 * 2 * 3];
            let bytes = encode_rgb(2, 2, &px);
            assert_eq!(
                &bytes[0..8],
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
            );
            // chunk types appear in order.
            let find = |needle: &[u8]| {
                bytes
                    .windows(4)
                    .position(|w| w == needle)
                    .expect("chunk present")
            };
            let (ihdr, idat, iend) = (find(b"IHDR"), find(b"IDAT"), find(b"IEND"));
            assert!(ihdr < idat && idat < iend, "chunk order");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> ContentDb {
        ContentDb::load(Path::new("../../content")).expect("content loads")
    }

    #[test]
    fn renders_real_zones_to_valid_pngs() {
        let db = db();
        for id in ["coast", "withered_shore", "saltmere", "test_range"] {
            let zone = db.zone(id).unwrap_or_else(|| panic!("zone {id}"));
            let ts = zone
                .tileset
                .as_deref()
                .and_then(|t| db.tileset(t))
                .expect("tileset");
            let (canvas, _unreachable) = render(zone, ts, 8);
            let grid = zone.tiles.as_ref().unwrap();
            assert_eq!(canvas.w, grid.width * 8);
            assert_eq!(canvas.h, grid.height * 8);
            let bytes = png::encode_rgb(canvas.w as u32, canvas.h as u32, &canvas.px);
            assert_eq!(
                &bytes[0..8],
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
            );
            assert!(bytes.len() > 100);
        }
    }
}

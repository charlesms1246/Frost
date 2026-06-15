/**
 * WebGL metaball "lava lamp" renderer used by GradientBackdrop.svelte.
 *
 * Draws a fullscreen quad whose fragment shader sums a handful of gaussian
 * blobs (circles) into a smooth metaball field, tinted with the frost palette
 * and composited over a vertical theme gradient. Circles drift with random
 * velocities chosen fresh on each start and wrap around the screen edges; one
 * extra circle gently lerps toward the pointer.
 *
 * The module is framework-agnostic and purely imperative: the Svelte component
 * owns the lifecycle (start / stop / theme + intensity updates). Every failure
 * path is non-throwing — callers fall back to a static CSS gradient when
 * `createMetaballField` returns `null`.
 */

const MAX_CIRCLES = 6;

export type Rgb = [number, number, number];

export interface MetaballTheme {
	/** Top of the background gradient (0..1 rgb). */
	top: Rgb;
	/** Bottom of the background gradient (0..1 rgb). */
	bottom: Rgb;
	/** Per-circle tints (0..1 rgb); index 0 is the interactive pointer blob. */
	colors: Rgb[];
	/** Overall blob opacity (how strongly blobs override the background). */
	strength: number;
}

export interface MetaballField {
	/** Begin the rAF loop with freshly randomized circles. */
	start(): void;
	/** Stop the rAF loop and detach listeners (idempotent). */
	stop(): void;
	/** Swap colors / strength live (e.g. on theme change). */
	setTheme(theme: MetaballTheme): void;
	/** Fully release GL + DOM listeners. */
	destroy(): void;
}

interface Circle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	interactive: boolean;
}

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
	v_uv = a_position * 0.5 + 0.5;
	v_uv.y = 1.0 - v_uv.y;
	gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform int u_circleCount;
uniform vec3 u_circlesColor[${MAX_CIRCLES}];
uniform vec3 u_circlesPosRad[${MAX_CIRCLES}];
uniform vec3 u_topColor;
uniform vec3 u_bottomColor;
uniform float u_strength;

void main() {
	vec2 st = v_uv * u_resolution;
	vec3 bgColor = mix(u_topColor, u_bottomColor, st.y / u_resolution.y);

	float fieldSum = 0.0;
	vec3 weightedColorSum = vec3(0.0);

	for (int i = 0; i < ${MAX_CIRCLES}; i++) {
		if (i >= u_circleCount) break;
		vec3 posRad = u_circlesPosRad[i];
		vec2 cPos = posRad.xy;
		float radius = posRad.z;
		float dist = length(st - cPos);
		float sigma = radius * 0.48;
		float val = exp(-(dist * dist) / (2.0 * sigma * sigma));
		fieldSum += val;
		weightedColorSum += u_circlesColor[i] * val;
	}

	vec3 finalCirclesColor = fieldSum > 0.0 ? weightedColorSum / fieldSum : vec3(0.0);
	float intensity = pow(fieldSum, 1.4) * u_strength;
	vec3 finalColor = mix(bgColor, finalCirclesColor, clamp(intensity, 0.0, 1.0));

	gl_FragColor = vec4(finalColor, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function rand(): number {
	return Math.random();
}

/**
 * Build (but do not start) a metaball renderer bound to `canvas`.
 * Returns `null` if WebGL is unavailable or the program fails to compile/link,
 * so callers can fall back to a static gradient without try/catch.
 *
 * @param interactive when false, no pointer blob is created and mousemove is
 *   not observed (used for non-fullscreen / decorative panels).
 */
export function createMetaballField(
	canvas: HTMLCanvasElement,
	initialTheme: MetaballTheme,
	interactive = true,
): MetaballField | null {
	let gl: WebGLRenderingContext | null = null;
	try {
		gl =
			(canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false }) as WebGLRenderingContext | null) ??
			(canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
	} catch {
		gl = null;
	}
	if (!gl) return null;

	const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
	const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
	if (!vert || !frag) return null;

	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vert);
	gl.attachShader(program, frag);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}
	gl.useProgram(program);

	// Fullscreen quad: two triangles (6 verts).
	const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
	const aPosition = gl.getAttribLocation(program, "a_position");
	gl.enableVertexAttribArray(aPosition);
	gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

	const uResolution = gl.getUniformLocation(program, "u_resolution");
	const uCircleCount = gl.getUniformLocation(program, "u_circleCount");
	const uColors = gl.getUniformLocation(program, "u_circlesColor");
	const uPosRad = gl.getUniformLocation(program, "u_circlesPosRad");
	const uTop = gl.getUniformLocation(program, "u_topColor");
	const uBottom = gl.getUniformLocation(program, "u_bottomColor");
	const uStrength = gl.getUniformLocation(program, "u_strength");

	let theme = initialTheme;
	let width = 1;
	let height = 1;
	let raf = 0;
	let running = false;
	let circles: Circle[] = [];
	const mouse = { x: 0, y: 0 };
	// Smoothed pointer parallax: the whole field gently drifts with the cursor.
	const parallax = { x: 0, y: 0 };

	const dpr = Math.min(window.devicePixelRatio || 1, 2);

	function resize() {
		const rect = canvas.getBoundingClientRect();
		width = Math.max(1, Math.round(rect.width));
		height = Math.max(1, Math.round(rect.height));
		canvas.width = Math.max(1, Math.round(rect.width * dpr));
		canvas.height = Math.max(1, Math.round(rect.height * dpr));
		gl!.viewport(0, 0, canvas.width, canvas.height);
	}

	function randomizeCircles() {
		// Smaller than the viewport so blobs read as DISTINCT drifting pools rather
		// than merging into one screen-filling wash.
		const base = (width + height) * 0.13;
		// 5 drifting circles, plus 1 interactive pointer blob when enabled.
		const target = interactive ? MAX_CIRCLES : MAX_CIRCLES - 1;
		circles = [];
		parallax.x = 0;
		parallax.y = 0;
		// Index 0 is the interactive pointer blob (smaller, lerps toward mouse).
		if (interactive) {
			circles.push({
				x: width * 0.5,
				y: height * 0.5,
				vx: 0,
				vy: 0,
				radius: (width + height) * 0.075,
				interactive: true,
			});
			mouse.x = width * 0.5;
			mouse.y = height * 0.5;
		}
		while (circles.length < target) {
			circles.push({
				x: rand() * width,
				y: rand() * height,
				// Random direction + random speed (left/right + up/down).
				vx: (rand() - 0.5) * (rand() * 4 + 1),
				vy: (rand() - 0.5) * (rand() * 4 + 1),
				radius: base * (0.7 + rand() * 0.5),
				interactive: false,
			});
		}
	}

	function update() {
		// Ease the field's parallax toward an offset driven by the pointer position
		// (relative to centre), so the whole background visibly reacts to the mouse.
		const targetPx = (mouse.x - width * 0.5) * 0.08;
		const targetPy = (mouse.y - height * 0.5) * 0.08;
		parallax.x += (targetPx - parallax.x) * 0.045;
		parallax.y += (targetPy - parallax.y) * 0.045;

		for (const c of circles) {
			if (c.interactive) {
				c.x += (mouse.x - c.x) * 0.1;
				c.y += (mouse.y - c.y) * 0.1;
				continue;
			}
			c.x += c.vx;
			c.y += c.vy;
			// Wrap once fully off an edge.
			if (c.x - c.radius > width) c.x = -c.radius;
			else if (c.x + c.radius < 0) c.x = width + c.radius;
			if (c.y - c.radius > height) c.y = -c.radius;
			else if (c.y + c.radius < 0) c.y = height + c.radius;
		}
	}

	function draw() {
		const g = gl!;
		const colorData = new Float32Array(MAX_CIRCLES * 3);
		const posRadData = new Float32Array(MAX_CIRCLES * 3);
		for (let i = 0; i < circles.length && i < MAX_CIRCLES; i++) {
			const c = circles[i];
			const tint = theme.colors[i % theme.colors.length] ?? theme.colors[0];
			colorData[i * 3] = tint[0];
			colorData[i * 3 + 1] = tint[1];
			colorData[i * 3 + 2] = tint[2];
			// Non-interactive blobs drift with the pointer parallax; the pointer blob
			// already tracks the cursor directly. Scale into device pixels.
			const px = c.interactive ? 0 : parallax.x;
			const py = c.interactive ? 0 : parallax.y;
			posRadData[i * 3] = (c.x + px) * dpr;
			posRadData[i * 3 + 1] = (c.y + py) * dpr;
			posRadData[i * 3 + 2] = c.radius * dpr;
		}

		g.uniform2f(uResolution, canvas.width, canvas.height);
		g.uniform1i(uCircleCount, Math.min(circles.length, MAX_CIRCLES));
		g.uniform3fv(uColors, colorData);
		g.uniform3fv(uPosRad, posRadData);
		g.uniform3f(uTop, theme.top[0], theme.top[1], theme.top[2]);
		g.uniform3f(uBottom, theme.bottom[0], theme.bottom[1], theme.bottom[2]);
		g.uniform1f(uStrength, theme.strength);

		g.drawArrays(g.TRIANGLES, 0, 6);
	}

	function frame() {
		update();
		draw();
		raf = window.requestAnimationFrame(frame);
	}

	function onMouseMove(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		mouse.x = e.clientX - rect.left;
		mouse.y = e.clientY - rect.top;
	}

	let ro: ResizeObserver | null = null;

	function start() {
		if (running) return;
		running = true;
		resize();
		randomizeCircles();

		if (typeof ResizeObserver !== "undefined") {
			ro = new ResizeObserver(() => {
				const prevW = width;
				const prevH = height;
				resize();
				// Keep circles in-bounds after a resize without re-randomizing.
				if (prevW > 0 && prevH > 0) {
					const sx = width / prevW;
					const sy = height / prevH;
					for (const c of circles) {
						c.x *= sx;
						c.y *= sy;
					}
				}
			});
			ro.observe(canvas);
		} else {
			window.addEventListener("resize", resize);
		}

		if (interactive) {
			window.addEventListener("mousemove", onMouseMove);
		}

		frame();
	}

	function stop() {
		if (!running) return;
		running = false;
		if (raf) window.cancelAnimationFrame(raf);
		raf = 0;
		if (ro) {
			ro.disconnect();
			ro = null;
		} else {
			window.removeEventListener("resize", resize);
		}
		if (interactive) {
			window.removeEventListener("mousemove", onMouseMove);
		}
	}

	function setTheme(next: MetaballTheme) {
		theme = next;
		// If stopped (reduced motion), paint one static frame so the gradient + blobs show.
		if (!running) {
			resize();
			if (circles.length === 0) randomizeCircles();
			draw();
		}
	}

	function destroy() {
		stop();
		const g = gl;
		if (g) {
			g.deleteProgram(program);
			g.deleteShader(vert!);
			g.deleteShader(frag!);
			g.deleteBuffer(buffer);
		}
	}

	return { start, stop, setTheme, destroy };
}

/** Parse a `#rrggbb` hex string into a 0..1 rgb triple. */
export function hexToRgb(hex: string): Rgb {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	return [r, g, b];
}

const PALETTE = {
	iceCyan: "#B7F4FF",
	periwinkle: "#7694E6",
	indigo: "#6377DF",
	violet: "#9d6cff",
	teal: "#38e0d0",
};

/**
 * Frost-palette theme for a given mode + loudness.
 *
 * Light: soft, low-saturation tints over a near-white base (blends are kept
 * weak so cards on top never look garish). Dark: richer tints over a
 * near-black/indigo base.
 */
export function frostTheme(isDark: boolean, intensity: "subtle" | "vivid"): MetaballTheme {
	const vivid = intensity === "vivid";
	const colors: Rgb[] = [
		hexToRgb(PALETTE.violet), // index 0 — interactive pointer blob
		hexToRgb(PALETTE.iceCyan),
		hexToRgb(PALETTE.indigo),
		hexToRgb(PALETTE.periwinkle),
		hexToRgb(PALETTE.teal),
		hexToRgb(PALETTE.violet),
	];

	if (isDark) {
		// Saturated, MEDIUM-luminance jewel tints — deliberately NOT near-white (a
		// bright wash washed out text). Clearly visible + drifting over near-black,
		// while the ~70%-opaque frosted cards on top stay readable.
		const darkColors: Rgb[] = [
			hexToRgb("#9a78ff"), // violet — interactive pointer/cursor glow (brightest)
			hexToRgb("#3a9fc8"), // cyan
			hexToRgb("#4a5fd6"), // indigo
			hexToRgb("#5f7be0"), // periwinkle
			hexToRgb("#2bb6a4"), // teal
			hexToRgb("#7d54e0"), // violet
		];
		return {
			top: hexToRgb("#08080f"),
			bottom: hexToRgb("#0c0b18"),
			colors: darkColors,
			// Kept gentle: on pages with no full-bleed cards (e.g. the chat) the field
			// shows through directly, so a softer blend avoids a harsh, eye-tiring wash.
			strength: vivid ? 0.58 : 0.4,
		};
	}

	// Light: lift each tint toward white, but keep more chroma than before so the
	// blobs read as clearly colored (not a near-white wash) over the pale base.
	const soften = (c: Rgb, amt: number): Rgb => [
		c[0] + (1 - c[0]) * amt,
		c[1] + (1 - c[1]) * amt,
		c[2] + (1 - c[2]) * amt,
	];
	const lightColors = colors.map((c) => soften(c, vivid ? 0.28 : 0.42));
	return {
		top: hexToRgb("#fbfdff"),
		bottom: hexToRgb("#eef1fb"),
		colors: lightColors,
		strength: vivid ? 0.74 : 0.62,
	};
}

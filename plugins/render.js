(function () {
'use strict';

/*
 * Render — a Blender style "render view" for Blockbench:
 *   - real materials (PBR): color/texture, roughness, metalness, normal map, emission, opacity, glass, clearcoat
 *   - a Materials window with ball previews, maps taken from the project textures or loaded as images
 *   - sun with soft shadows, sky light and reflections, a floor that catches shadows
 *   - post effects: ambient occlusion (SSAO), screen space reflections (SSR), bloom, depth of field, anti-aliasing,
 *     exposure, vignette
 * Toggle it with View > Render view (works in every tab, also while an animation plays).
 * Post processing passes come from three.js r129 examples (MIT), the same three.js version Blockbench uses.
 */

// ---------------------------------------------------------------------------
// three.js r129 examples (EffectComposer, SSAO, SSR, bloom, bokeh, FXAA...)
// ---------------------------------------------------------------------------

// --- three.js r129 examples/js/CopyShader.js ---
( function () {

	/**
 * Full-screen textured quad shader
 */
	var CopyShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'opacity': {
				value: 1.0
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;

		}`
	};

	THREE.CopyShader = CopyShader;

} )();

// --- three.js r129 examples/js/EffectComposer.js ---
( function () {

	class EffectComposer {

		constructor( renderer, renderTarget ) {

			this.renderer = renderer;

			if ( renderTarget === undefined ) {

				const parameters = {
					minFilter: THREE.LinearFilter,
					magFilter: THREE.LinearFilter,
					format: THREE.RGBAFormat
				};
				const size = renderer.getSize( new THREE.Vector2() );
				this._pixelRatio = renderer.getPixelRatio();
				this._width = size.width;
				this._height = size.height;
				renderTarget = new THREE.WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, parameters );
				renderTarget.texture.name = 'EffectComposer.rt1';

			} else {

				this._pixelRatio = 1;
				this._width = renderTarget.width;
				this._height = renderTarget.height;

			}

			this.renderTarget1 = renderTarget;
			this.renderTarget2 = renderTarget.clone();
			this.renderTarget2.texture.name = 'EffectComposer.rt2';
			this.writeBuffer = this.renderTarget1;
			this.readBuffer = this.renderTarget2;
			this.renderToScreen = true;
			this.passes = []; // dependencies

			if ( THREE.CopyShader === undefined ) {

				console.error( 'THREE.EffectComposer relies on THREE.CopyShader' );

			}

			if ( THREE.ShaderPass === undefined ) {

				console.error( 'THREE.EffectComposer relies on THREE.ShaderPass' );

			}

			this.copyPass = new THREE.ShaderPass( THREE.CopyShader );
			this.clock = new THREE.Clock();

		}

		swapBuffers() {

			const tmp = this.readBuffer;
			this.readBuffer = this.writeBuffer;
			this.writeBuffer = tmp;

		}

		addPass( pass ) {

			this.passes.push( pass );
			pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		insertPass( pass, index ) {

			this.passes.splice( index, 0, pass );
			pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		removePass( pass ) {

			const index = this.passes.indexOf( pass );

			if ( index !== - 1 ) {

				this.passes.splice( index, 1 );

			}

		}

		isLastEnabledPass( passIndex ) {

			for ( let i = passIndex + 1; i < this.passes.length; i ++ ) {

				if ( this.passes[ i ].enabled ) {

					return false;

				}

			}

			return true;

		}

		render( deltaTime ) {

			// deltaTime value is in seconds
			if ( deltaTime === undefined ) {

				deltaTime = this.clock.getDelta();

			}

			const currentRenderTarget = this.renderer.getRenderTarget();
			let maskActive = false;

			for ( let i = 0, il = this.passes.length; i < il; i ++ ) {

				const pass = this.passes[ i ];
				if ( pass.enabled === false ) continue;
				pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass( i );
				pass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive );

				if ( pass.needsSwap ) {

					if ( maskActive ) {

						const context = this.renderer.getContext();
						const stencil = this.renderer.state.buffers.stencil; //context.stencilFunc( context.NOTEQUAL, 1, 0xffffffff );

						stencil.setFunc( context.NOTEQUAL, 1, 0xffffffff );
						this.copyPass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime ); //context.stencilFunc( context.EQUAL, 1, 0xffffffff );

						stencil.setFunc( context.EQUAL, 1, 0xffffffff );

					}

					this.swapBuffers();

				}

				if ( THREE.MaskPass !== undefined ) {

					if ( pass instanceof THREE.MaskPass ) {

						maskActive = true;

					} else if ( pass instanceof THREE.ClearMaskPass ) {

						maskActive = false;

					}

				}

			}

			this.renderer.setRenderTarget( currentRenderTarget );

		}

		reset( renderTarget ) {

			if ( renderTarget === undefined ) {

				const size = this.renderer.getSize( new THREE.Vector2() );
				this._pixelRatio = this.renderer.getPixelRatio();
				this._width = size.width;
				this._height = size.height;
				renderTarget = this.renderTarget1.clone();
				renderTarget.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

			}

			this.renderTarget1.dispose();
			this.renderTarget2.dispose();
			this.renderTarget1 = renderTarget;
			this.renderTarget2 = renderTarget.clone();
			this.writeBuffer = this.renderTarget1;
			this.readBuffer = this.renderTarget2;

		}

		setSize( width, height ) {

			this._width = width;
			this._height = height;
			const effectiveWidth = this._width * this._pixelRatio;
			const effectiveHeight = this._height * this._pixelRatio;
			this.renderTarget1.setSize( effectiveWidth, effectiveHeight );
			this.renderTarget2.setSize( effectiveWidth, effectiveHeight );

			for ( let i = 0; i < this.passes.length; i ++ ) {

				this.passes[ i ].setSize( effectiveWidth, effectiveHeight );

			}

		}

		setPixelRatio( pixelRatio ) {

			this._pixelRatio = pixelRatio;
			this.setSize( this._width, this._height );

		}

	}

	class Pass {

		constructor() {

			// if set to true, the pass is processed by the composer
			this.enabled = true; // if set to true, the pass indicates to swap read and write buffer after rendering

			this.needsSwap = true; // if set to true, the pass clears its buffer before rendering

			this.clear = false; // if set to true, the result of the pass is rendered to screen. This is set automatically by EffectComposer.

			this.renderToScreen = false;

		}

		setSize( ) {}

		render( ) {

			console.error( 'THREE.Pass: .render() must be implemented in derived pass.' );

		}

	} // Helper for passes that need to fill the viewport with a single quad.


	const _camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 ); // https://github.com/mrdoob/three.js/pull/21358


	const _geometry = new THREE.BufferGeometry();

	_geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, 3, 0, - 1, - 1, 0, 3, - 1, 0 ], 3 ) );

	_geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 2, 0, 0, 2, 0 ], 2 ) );

	class FullScreenQuad {

		constructor( material ) {

			this._mesh = new THREE.Mesh( _geometry, material );

		}

		dispose() {

			this._mesh.geometry.dispose();

		}

		render( renderer ) {

			renderer.render( this._mesh, _camera );

		}

		get material() {

			return this._mesh.material;

		}

		set material( value ) {

			this._mesh.material = value;

		}

	}

	THREE.EffectComposer = EffectComposer;
	THREE.FullScreenQuad = FullScreenQuad;
	THREE.Pass = Pass;

} )();

// --- three.js r129 examples/js/ShaderPass.js ---
( function () {

	class ShaderPass extends THREE.Pass {

		constructor( shader, textureID ) {

			super();
			this.textureID = textureID !== undefined ? textureID : 'tDiffuse';

			if ( shader instanceof THREE.ShaderMaterial ) {

				this.uniforms = shader.uniforms;
				this.material = shader;

			} else if ( shader ) {

				this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );
				this.material = new THREE.ShaderMaterial( {
					defines: Object.assign( {}, shader.defines ),
					uniforms: this.uniforms,
					vertexShader: shader.vertexShader,
					fragmentShader: shader.fragmentShader
				} );

			}

			this.fsQuad = new THREE.FullScreenQuad( this.material );

		}

		render( renderer, writeBuffer, readBuffer
			/*, deltaTime, maskActive */
		) {

			if ( this.uniforms[ this.textureID ] ) {

				this.uniforms[ this.textureID ].value = readBuffer.texture;

			}

			this.fsQuad.material = this.material;

			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );
				this.fsQuad.render( renderer );

			} else {

				renderer.setRenderTarget( writeBuffer ); // TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600

				if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
				this.fsQuad.render( renderer );

			}

		}

	}

	THREE.ShaderPass = ShaderPass;

} )();

// --- three.js r129 examples/js/RenderPass.js ---
( function () {

	class RenderPass extends THREE.Pass {

		constructor( scene, camera, overrideMaterial, clearColor, clearAlpha ) {

			super();
			this.scene = scene;
			this.camera = camera;
			this.overrideMaterial = overrideMaterial;
			this.clearColor = clearColor;
			this.clearAlpha = clearAlpha !== undefined ? clearAlpha : 0;
			this.clear = true;
			this.clearDepth = false;
			this.needsSwap = false;
			this._oldClearColor = new THREE.Color();

		}

		render( renderer, writeBuffer, readBuffer
			/*, deltaTime, maskActive */
		) {

			const oldAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			let oldClearAlpha, oldOverrideMaterial;

			if ( this.overrideMaterial !== undefined ) {

				oldOverrideMaterial = this.scene.overrideMaterial;
				this.scene.overrideMaterial = this.overrideMaterial;

			}

			if ( this.clearColor ) {

				renderer.getClearColor( this._oldClearColor );
				oldClearAlpha = renderer.getClearAlpha();
				renderer.setClearColor( this.clearColor, this.clearAlpha );

			}

			if ( this.clearDepth ) {

				renderer.clearDepth();

			}

			renderer.setRenderTarget( this.renderToScreen ? null : readBuffer ); // TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600

			if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
			renderer.render( this.scene, this.camera );

			if ( this.clearColor ) {

				renderer.setClearColor( this._oldClearColor, oldClearAlpha );

			}

			if ( this.overrideMaterial !== undefined ) {

				this.scene.overrideMaterial = oldOverrideMaterial;

			}

			renderer.autoClear = oldAutoClear;

		}

	}

	THREE.RenderPass = RenderPass;

} )();

// --- three.js r129 examples/js/MaskPass.js ---
( function () {

	class MaskPass extends THREE.Pass {

		constructor( scene, camera ) {

			super();
			this.scene = scene;
			this.camera = camera;
			this.clear = true;
			this.needsSwap = false;
			this.inverse = false;

		}

		render( renderer, writeBuffer, readBuffer
			/*, deltaTime, maskActive */
		) {

			const context = renderer.getContext();
			const state = renderer.state; // don't update color or depth

			state.buffers.color.setMask( false );
			state.buffers.depth.setMask( false ); // lock buffers

			state.buffers.color.setLocked( true );
			state.buffers.depth.setLocked( true ); // set up stencil

			let writeValue, clearValue;

			if ( this.inverse ) {

				writeValue = 0;
				clearValue = 1;

			} else {

				writeValue = 1;
				clearValue = 0;

			}

			state.buffers.stencil.setTest( true );
			state.buffers.stencil.setOp( context.REPLACE, context.REPLACE, context.REPLACE );
			state.buffers.stencil.setFunc( context.ALWAYS, writeValue, 0xffffffff );
			state.buffers.stencil.setClear( clearValue );
			state.buffers.stencil.setLocked( true ); // draw into the stencil buffer

			renderer.setRenderTarget( readBuffer );
			if ( this.clear ) renderer.clear();
			renderer.render( this.scene, this.camera );
			renderer.setRenderTarget( writeBuffer );
			if ( this.clear ) renderer.clear();
			renderer.render( this.scene, this.camera ); // unlock color and depth buffer for subsequent rendering

			state.buffers.color.setLocked( false );
			state.buffers.depth.setLocked( false ); // only render where stencil is set to 1

			state.buffers.stencil.setLocked( false );
			state.buffers.stencil.setFunc( context.EQUAL, 1, 0xffffffff ); // draw if == 1

			state.buffers.stencil.setOp( context.KEEP, context.KEEP, context.KEEP );
			state.buffers.stencil.setLocked( true );

		}

	}

	class ClearMaskPass extends THREE.Pass {

		constructor() {

			super();
			this.needsSwap = false;

		}

		render( renderer
			/*, writeBuffer, readBuffer, deltaTime, maskActive */
		) {

			renderer.state.buffers.stencil.setLocked( false );
			renderer.state.buffers.stencil.setTest( false );

		}

	}

	THREE.ClearMaskPass = ClearMaskPass;
	THREE.MaskPass = MaskPass;

} )();

// --- three.js r129 examples/js/SimplexNoise.js ---
( function () {

	// Ported from Stefan Gustavson's java implementation
	// http://staffwww.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf
	// Read Stefan's excellent paper for details on how this code works.
	//
	// Sean McCullough banksean@gmail.com
	//
	// Added 4D noise

	/**
 * You can pass in a random number generator object if you like.
 * It is assumed to have a random() method.
 */
	class SimplexNoise {

		constructor( r = Math ) {

			this.grad3 = [[ 1, 1, 0 ], [ - 1, 1, 0 ], [ 1, - 1, 0 ], [ - 1, - 1, 0 ], [ 1, 0, 1 ], [ - 1, 0, 1 ], [ 1, 0, - 1 ], [ - 1, 0, - 1 ], [ 0, 1, 1 ], [ 0, - 1, 1 ], [ 0, 1, - 1 ], [ 0, - 1, - 1 ]];
			this.grad4 = [[ 0, 1, 1, 1 ], [ 0, 1, 1, - 1 ], [ 0, 1, - 1, 1 ], [ 0, 1, - 1, - 1 ], [ 0, - 1, 1, 1 ], [ 0, - 1, 1, - 1 ], [ 0, - 1, - 1, 1 ], [ 0, - 1, - 1, - 1 ], [ 1, 0, 1, 1 ], [ 1, 0, 1, - 1 ], [ 1, 0, - 1, 1 ], [ 1, 0, - 1, - 1 ], [ - 1, 0, 1, 1 ], [ - 1, 0, 1, - 1 ], [ - 1, 0, - 1, 1 ], [ - 1, 0, - 1, - 1 ], [ 1, 1, 0, 1 ], [ 1, 1, 0, - 1 ], [ 1, - 1, 0, 1 ], [ 1, - 1, 0, - 1 ], [ - 1, 1, 0, 1 ], [ - 1, 1, 0, - 1 ], [ - 1, - 1, 0, 1 ], [ - 1, - 1, 0, - 1 ], [ 1, 1, 1, 0 ], [ 1, 1, - 1, 0 ], [ 1, - 1, 1, 0 ], [ 1, - 1, - 1, 0 ], [ - 1, 1, 1, 0 ], [ - 1, 1, - 1, 0 ], [ - 1, - 1, 1, 0 ], [ - 1, - 1, - 1, 0 ]];
			this.p = [];

			for ( let i = 0; i < 256; i ++ ) {

				this.p[ i ] = Math.floor( r.random() * 256 );

			} // To remove the need for index wrapping, double the permutation table length


			this.perm = [];

			for ( let i = 0; i < 512; i ++ ) {

				this.perm[ i ] = this.p[ i & 255 ];

			} // A lookup table to traverse the simplex around a given point in 4D.
			// Details can be found where this table is used, in the 4D noise method.


			this.simplex = [[ 0, 1, 2, 3 ], [ 0, 1, 3, 2 ], [ 0, 0, 0, 0 ], [ 0, 2, 3, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 2, 3, 0 ], [ 0, 2, 1, 3 ], [ 0, 0, 0, 0 ], [ 0, 3, 1, 2 ], [ 0, 3, 2, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 3, 2, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 1, 2, 0, 3 ], [ 0, 0, 0, 0 ], [ 1, 3, 0, 2 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 3, 0, 1 ], [ 2, 3, 1, 0 ], [ 1, 0, 2, 3 ], [ 1, 0, 3, 2 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 0, 3, 1 ], [ 0, 0, 0, 0 ], [ 2, 1, 3, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 2, 0, 1, 3 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 3, 0, 1, 2 ], [ 3, 0, 2, 1 ], [ 0, 0, 0, 0 ], [ 3, 1, 2, 0 ], [ 2, 1, 0, 3 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], [ 3, 1, 0, 2 ], [ 0, 0, 0, 0 ], [ 3, 2, 0, 1 ], [ 3, 2, 1, 0 ]];

		}

		dot( g, x, y ) {

			return g[ 0 ] * x + g[ 1 ] * y;

		}

		dot3( g, x, y, z ) {

			return g[ 0 ] * x + g[ 1 ] * y + g[ 2 ] * z;

		}

		dot4( g, x, y, z, w ) {

			return g[ 0 ] * x + g[ 1 ] * y + g[ 2 ] * z + g[ 3 ] * w;

		}

		noise( xin, yin ) {

			let n0; // Noise contributions from the three corners

			let n1;
			let n2; // Skew the input space to determine which simplex cell we're in

			const F2 = 0.5 * ( Math.sqrt( 3.0 ) - 1.0 );
			const s = ( xin + yin ) * F2; // Hairy factor for 2D

			const i = Math.floor( xin + s );
			const j = Math.floor( yin + s );
			const G2 = ( 3.0 - Math.sqrt( 3.0 ) ) / 6.0;
			const t = ( i + j ) * G2;
			const X0 = i - t; // Unskew the cell origin back to (x,y) space

			const Y0 = j - t;
			const x0 = xin - X0; // The x,y distances from the cell origin

			const y0 = yin - Y0; // For the 2D case, the simplex shape is an equilateral triangle.
			// Determine which simplex we are in.

			let i1; // Offsets for second (middle) corner of simplex in (i,j) coords

			let j1;

			if ( x0 > y0 ) {

				i1 = 1;
				j1 = 0; // lower triangle, XY order: (0,0)->(1,0)->(1,1)

			} else {

				i1 = 0;
				j1 = 1;

			} // upper triangle, YX order: (0,0)->(0,1)->(1,1)
			// A step of (1,0) in (i,j) means a step of (1-c,-c) in (x,y), and
			// a step of (0,1) in (i,j) means a step of (-c,1-c) in (x,y), where
			// c = (3-sqrt(3))/6


			const x1 = x0 - i1 + G2; // Offsets for middle corner in (x,y) unskewed coords

			const y1 = y0 - j1 + G2;
			const x2 = x0 - 1.0 + 2.0 * G2; // Offsets for last corner in (x,y) unskewed coords

			const y2 = y0 - 1.0 + 2.0 * G2; // Work out the hashed gradient indices of the three simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const gi0 = this.perm[ ii + this.perm[ jj ] ] % 12;
			const gi1 = this.perm[ ii + i1 + this.perm[ jj + j1 ] ] % 12;
			const gi2 = this.perm[ ii + 1 + this.perm[ jj + 1 ] ] % 12; // Calculate the contribution from the three corners

			let t0 = 0.5 - x0 * x0 - y0 * y0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot( this.grad3[ gi0 ], x0, y0 ); // (x,y) of grad3 used for 2D gradient

			}

			let t1 = 0.5 - x1 * x1 - y1 * y1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot( this.grad3[ gi1 ], x1, y1 );

			}

			let t2 = 0.5 - x2 * x2 - y2 * y2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot( this.grad3[ gi2 ], x2, y2 );

			} // Add contributions from each corner to get the final noise value.
			// The result is scaled to return values in the interval [-1,1].

			return 70.0 * ( n0 + n1 + n2 );

		} // 3D simplex noise


		noise3d( xin, yin, zin ) {

			let n0; // Noise contributions from the four corners

			let n1;
			let n2;
			let n3; // Skew the input space to determine which simplex cell we're in

			const F3 = 1.0 / 3.0;
			const s = ( xin + yin + zin ) * F3; // Very nice and simple skew factor for 3D

			const i = Math.floor( xin + s );
			const j = Math.floor( yin + s );
			const k = Math.floor( zin + s );
			const G3 = 1.0 / 6.0; // Very nice and simple unskew factor, too

			const t = ( i + j + k ) * G3;
			const X0 = i - t; // Unskew the cell origin back to (x,y,z) space

			const Y0 = j - t;
			const Z0 = k - t;
			const x0 = xin - X0; // The x,y,z distances from the cell origin

			const y0 = yin - Y0;
			const z0 = zin - Z0; // For the 3D case, the simplex shape is a slightly irregular tetrahedron.
			// Determine which simplex we are in.

			let i1; // Offsets for second corner of simplex in (i,j,k) coords

			let j1;
			let k1;
			let i2; // Offsets for third corner of simplex in (i,j,k) coords

			let j2;
			let k2;

			if ( x0 >= y0 ) {

				if ( y0 >= z0 ) {

					i1 = 1;
					j1 = 0;
					k1 = 0;
					i2 = 1;
					j2 = 1;
					k2 = 0; // X Y Z order

				} else if ( x0 >= z0 ) {

					i1 = 1;
					j1 = 0;
					k1 = 0;
					i2 = 1;
					j2 = 0;
					k2 = 1; // X Z Y order

				} else {

					i1 = 0;
					j1 = 0;
					k1 = 1;
					i2 = 1;
					j2 = 0;
					k2 = 1;

				} // Z X Y order

			} else {

				// x0<y0
				if ( y0 < z0 ) {

					i1 = 0;
					j1 = 0;
					k1 = 1;
					i2 = 0;
					j2 = 1;
					k2 = 1; // Z Y X order

				} else if ( x0 < z0 ) {

					i1 = 0;
					j1 = 1;
					k1 = 0;
					i2 = 0;
					j2 = 1;
					k2 = 1; // Y Z X order

				} else {

					i1 = 0;
					j1 = 1;
					k1 = 0;
					i2 = 1;
					j2 = 1;
					k2 = 0;

				} // Y X Z order

			} // A step of (1,0,0) in (i,j,k) means a step of (1-c,-c,-c) in (x,y,z),
			// a step of (0,1,0) in (i,j,k) means a step of (-c,1-c,-c) in (x,y,z), and
			// a step of (0,0,1) in (i,j,k) means a step of (-c,-c,1-c) in (x,y,z), where
			// c = 1/6.


			const x1 = x0 - i1 + G3; // Offsets for second corner in (x,y,z) coords

			const y1 = y0 - j1 + G3;
			const z1 = z0 - k1 + G3;
			const x2 = x0 - i2 + 2.0 * G3; // Offsets for third corner in (x,y,z) coords

			const y2 = y0 - j2 + 2.0 * G3;
			const z2 = z0 - k2 + 2.0 * G3;
			const x3 = x0 - 1.0 + 3.0 * G3; // Offsets for last corner in (x,y,z) coords

			const y3 = y0 - 1.0 + 3.0 * G3;
			const z3 = z0 - 1.0 + 3.0 * G3; // Work out the hashed gradient indices of the four simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const kk = k & 255;
			const gi0 = this.perm[ ii + this.perm[ jj + this.perm[ kk ] ] ] % 12;
			const gi1 = this.perm[ ii + i1 + this.perm[ jj + j1 + this.perm[ kk + k1 ] ] ] % 12;
			const gi2 = this.perm[ ii + i2 + this.perm[ jj + j2 + this.perm[ kk + k2 ] ] ] % 12;
			const gi3 = this.perm[ ii + 1 + this.perm[ jj + 1 + this.perm[ kk + 1 ] ] ] % 12; // Calculate the contribution from the four corners

			let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot3( this.grad3[ gi0 ], x0, y0, z0 );

			}

			let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot3( this.grad3[ gi1 ], x1, y1, z1 );

			}

			let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot3( this.grad3[ gi2 ], x2, y2, z2 );

			}

			let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
			if ( t3 < 0 ) n3 = 0.0; else {

				t3 *= t3;
				n3 = t3 * t3 * this.dot3( this.grad3[ gi3 ], x3, y3, z3 );

			} // Add contributions from each corner to get the final noise value.
			// The result is scaled to stay just inside [-1,1]

			return 32.0 * ( n0 + n1 + n2 + n3 );

		} // 4D simplex noise


		noise4d( x, y, z, w ) {

			// For faster and easier lookups
			const grad4 = this.grad4;
			const simplex = this.simplex;
			const perm = this.perm; // The skewing and unskewing factors are hairy again for the 4D case

			const F4 = ( Math.sqrt( 5.0 ) - 1.0 ) / 4.0;
			const G4 = ( 5.0 - Math.sqrt( 5.0 ) ) / 20.0;
			let n0; // Noise contributions from the five corners

			let n1;
			let n2;
			let n3;
			let n4; // Skew the (x,y,z,w) space to determine which cell of 24 simplices we're in

			const s = ( x + y + z + w ) * F4; // Factor for 4D skewing

			const i = Math.floor( x + s );
			const j = Math.floor( y + s );
			const k = Math.floor( z + s );
			const l = Math.floor( w + s );
			const t = ( i + j + k + l ) * G4; // Factor for 4D unskewing

			const X0 = i - t; // Unskew the cell origin back to (x,y,z,w) space

			const Y0 = j - t;
			const Z0 = k - t;
			const W0 = l - t;
			const x0 = x - X0; // The x,y,z,w distances from the cell origin

			const y0 = y - Y0;
			const z0 = z - Z0;
			const w0 = w - W0; // For the 4D case, the simplex is a 4D shape I won't even try to describe.
			// To find out which of the 24 possible simplices we're in, we need to
			// determine the magnitude ordering of x0, y0, z0 and w0.
			// The method below is a good way of finding the ordering of x,y,z,w and
			// then find the correct traversal order for the simplex we’re in.
			// First, six pair-wise comparisons are performed between each possible pair
			// of the four coordinates, and the results are used to add up binary bits
			// for an integer index.

			const c1 = x0 > y0 ? 32 : 0;
			const c2 = x0 > z0 ? 16 : 0;
			const c3 = y0 > z0 ? 8 : 0;
			const c4 = x0 > w0 ? 4 : 0;
			const c5 = y0 > w0 ? 2 : 0;
			const c6 = z0 > w0 ? 1 : 0;
			const c = c1 + c2 + c3 + c4 + c5 + c6; // simplex[c] is a 4-vector with the numbers 0, 1, 2 and 3 in some order.
			// Many values of c will never occur, since e.g. x>y>z>w makes x<z, y<w and x<w
			// impossible. Only the 24 indices which have non-zero entries make any sense.
			// We use a thresholding to set the coordinates in turn from the largest magnitude.
			// The number 3 in the "simplex" array is at the position of the largest coordinate.

			const i1 = simplex[ c ][ 0 ] >= 3 ? 1 : 0;
			const j1 = simplex[ c ][ 1 ] >= 3 ? 1 : 0;
			const k1 = simplex[ c ][ 2 ] >= 3 ? 1 : 0;
			const l1 = simplex[ c ][ 3 ] >= 3 ? 1 : 0; // The number 2 in the "simplex" array is at the second largest coordinate.

			const i2 = simplex[ c ][ 0 ] >= 2 ? 1 : 0;
			const j2 = simplex[ c ][ 1 ] >= 2 ? 1 : 0;
			const k2 = simplex[ c ][ 2 ] >= 2 ? 1 : 0;
			const l2 = simplex[ c ][ 3 ] >= 2 ? 1 : 0; // The number 1 in the "simplex" array is at the second smallest coordinate.

			const i3 = simplex[ c ][ 0 ] >= 1 ? 1 : 0;
			const j3 = simplex[ c ][ 1 ] >= 1 ? 1 : 0;
			const k3 = simplex[ c ][ 2 ] >= 1 ? 1 : 0;
			const l3 = simplex[ c ][ 3 ] >= 1 ? 1 : 0; // The fifth corner has all coordinate offsets = 1, so no need to look that up.

			const x1 = x0 - i1 + G4; // Offsets for second corner in (x,y,z,w) coords

			const y1 = y0 - j1 + G4;
			const z1 = z0 - k1 + G4;
			const w1 = w0 - l1 + G4;
			const x2 = x0 - i2 + 2.0 * G4; // Offsets for third corner in (x,y,z,w) coords

			const y2 = y0 - j2 + 2.0 * G4;
			const z2 = z0 - k2 + 2.0 * G4;
			const w2 = w0 - l2 + 2.0 * G4;
			const x3 = x0 - i3 + 3.0 * G4; // Offsets for fourth corner in (x,y,z,w) coords

			const y3 = y0 - j3 + 3.0 * G4;
			const z3 = z0 - k3 + 3.0 * G4;
			const w3 = w0 - l3 + 3.0 * G4;
			const x4 = x0 - 1.0 + 4.0 * G4; // Offsets for last corner in (x,y,z,w) coords

			const y4 = y0 - 1.0 + 4.0 * G4;
			const z4 = z0 - 1.0 + 4.0 * G4;
			const w4 = w0 - 1.0 + 4.0 * G4; // Work out the hashed gradient indices of the five simplex corners

			const ii = i & 255;
			const jj = j & 255;
			const kk = k & 255;
			const ll = l & 255;
			const gi0 = perm[ ii + perm[ jj + perm[ kk + perm[ ll ] ] ] ] % 32;
			const gi1 = perm[ ii + i1 + perm[ jj + j1 + perm[ kk + k1 + perm[ ll + l1 ] ] ] ] % 32;
			const gi2 = perm[ ii + i2 + perm[ jj + j2 + perm[ kk + k2 + perm[ ll + l2 ] ] ] ] % 32;
			const gi3 = perm[ ii + i3 + perm[ jj + j3 + perm[ kk + k3 + perm[ ll + l3 ] ] ] ] % 32;
			const gi4 = perm[ ii + 1 + perm[ jj + 1 + perm[ kk + 1 + perm[ ll + 1 ] ] ] ] % 32; // Calculate the contribution from the five corners

			let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
			if ( t0 < 0 ) n0 = 0.0; else {

				t0 *= t0;
				n0 = t0 * t0 * this.dot4( grad4[ gi0 ], x0, y0, z0, w0 );

			}

			let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
			if ( t1 < 0 ) n1 = 0.0; else {

				t1 *= t1;
				n1 = t1 * t1 * this.dot4( grad4[ gi1 ], x1, y1, z1, w1 );

			}

			let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
			if ( t2 < 0 ) n2 = 0.0; else {

				t2 *= t2;
				n2 = t2 * t2 * this.dot4( grad4[ gi2 ], x2, y2, z2, w2 );

			}

			let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
			if ( t3 < 0 ) n3 = 0.0; else {

				t3 *= t3;
				n3 = t3 * t3 * this.dot4( grad4[ gi3 ], x3, y3, z3, w3 );

			}

			let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
			if ( t4 < 0 ) n4 = 0.0; else {

				t4 *= t4;
				n4 = t4 * t4 * this.dot4( grad4[ gi4 ], x4, y4, z4, w4 );

			} // Sum up and scale the result to cover the range [-1,1]

			return 27.0 * ( n0 + n1 + n2 + n3 + n4 );

		}

	}

	THREE.SimplexNoise = SimplexNoise;

} )();

// --- three.js r129 examples/js/SSAOShader.js ---
( function () {

	/**
 * References:
 * http://john-chapman-graphics.blogspot.com/2013/01/ssao-tutorial.html
 * https://learnopengl.com/Advanced-Lighting/SSAO
 * https://github.com/McNopper/OpenGL/blob/master/Example28/shader/ssao.frag.glsl
 */

	const SSAOShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1,
			'KERNEL_SIZE': 32
		},
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'tNormal': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'tNoise': {
				value: null
			},
			'kernel': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'cameraProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'cameraInverseProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'kernelRadius': {
				value: 8
			},
			'minDistance': {
				value: 0.005
			},
			'maxDistance': {
				value: 0.05
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		uniform sampler2D tDiffuse;
		uniform sampler2D tNormal;
		uniform sampler2D tDepth;
		uniform sampler2D tNoise;

		uniform vec3 kernel[ KERNEL_SIZE ];

		uniform vec2 resolution;

		uniform float cameraNear;
		uniform float cameraFar;
		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraInverseProjectionMatrix;

		uniform float kernelRadius;
		uniform float minDistance; // avoid artifacts caused by neighbour fragments with minimal depth difference
		uniform float maxDistance; // avoid the influence of fragments which are too far away

		varying vec2 vUv;

		#include <packing>

		float getDepth( const in vec2 screenPosition ) {

			return texture2D( tDepth, screenPosition ).x;

		}

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		float getViewZ( const in float depth ) {

			#if PERSPECTIVE_CAMERA == 1

				return perspectiveDepthToViewZ( depth, cameraNear, cameraFar );

			#else

				return orthographicDepthToViewZ( depth, cameraNear, cameraFar );

			#endif

		}

		vec3 getViewPosition( const in vec2 screenPosition, const in float depth, const in float viewZ ) {

			float clipW = cameraProjectionMatrix[2][3] * viewZ + cameraProjectionMatrix[3][3];

			vec4 clipPosition = vec4( ( vec3( screenPosition, depth ) - 0.5 ) * 2.0, 1.0 );

			clipPosition *= clipW; // unprojection.

			return ( cameraInverseProjectionMatrix * clipPosition ).xyz;

		}

		vec3 getViewNormal( const in vec2 screenPosition ) {

			return unpackRGBToNormal( texture2D( tNormal, screenPosition ).xyz );

		}

		void main() {

			float depth = getDepth( vUv );
			float viewZ = getViewZ( depth );

			vec3 viewPosition = getViewPosition( vUv, depth, viewZ );
			vec3 viewNormal = getViewNormal( vUv );

			vec2 noiseScale = vec2( resolution.x / 4.0, resolution.y / 4.0 );
			vec3 random = texture2D( tNoise, vUv * noiseScale ).xyz;

			// compute matrix used to reorient a kernel vector

			vec3 tangent = normalize( random - viewNormal * dot( random, viewNormal ) );
			vec3 bitangent = cross( viewNormal, tangent );
			mat3 kernelMatrix = mat3( tangent, bitangent, viewNormal );

		 float occlusion = 0.0;

		 for ( int i = 0; i < KERNEL_SIZE; i ++ ) {

				vec3 sampleVector = kernelMatrix * kernel[ i ]; // reorient sample vector in view space
				vec3 samplePoint = viewPosition + ( sampleVector * kernelRadius ); // calculate sample point

				vec4 samplePointNDC = cameraProjectionMatrix * vec4( samplePoint, 1.0 ); // project point and calculate NDC
				samplePointNDC /= samplePointNDC.w;

				vec2 samplePointUv = samplePointNDC.xy * 0.5 + 0.5; // compute uv coordinates

				float realDepth = getLinearDepth( samplePointUv ); // get linear depth from depth texture
				float sampleDepth = viewZToOrthographicDepth( samplePoint.z, cameraNear, cameraFar ); // compute linear depth of the sample view Z value
				float delta = sampleDepth - realDepth;

				if ( delta > minDistance && delta < maxDistance ) { // if fragment is before sample point, increase occlusion

					occlusion += 1.0;

				}

			}

			occlusion = clamp( occlusion / float( KERNEL_SIZE ), 0.0, 1.0 );

			gl_FragColor = vec4( vec3( 1.0 - occlusion ), 1.0 );

		}`
	};
	const SSAODepthShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tDepth': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDepth;

		uniform float cameraNear;
		uniform float cameraFar;

		varying vec2 vUv;

		#include <packing>

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		void main() {

			float depth = getLinearDepth( vUv );
			gl_FragColor = vec4( vec3( 1.0 - depth ), 1.0 );

		}`
	};
	const SSAOBlurShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		void main() {

			vec2 texelSize = ( 1.0 / resolution );
			float result = 0.0;

			for ( int i = - 2; i <= 2; i ++ ) {

				for ( int j = - 2; j <= 2; j ++ ) {

					vec2 offset = ( vec2( float( i ), float( j ) ) ) * texelSize;
					result += texture2D( tDiffuse, vUv + offset ).r;

				}

			}

			gl_FragColor = vec4( vec3( result / ( 5.0 * 5.0 ) ), 1.0 );

		}`
	};

	THREE.SSAOBlurShader = SSAOBlurShader;
	THREE.SSAODepthShader = SSAODepthShader;
	THREE.SSAOShader = SSAOShader;

} )();

// --- three.js r129 examples/js/SSAOPass.js ---
( function () {

	class SSAOPass extends THREE.Pass {

		constructor( scene, camera, width, height ) {

			super();
			this.width = width !== undefined ? width : 512;
			this.height = height !== undefined ? height : 512;
			this.clear = true;
			this.camera = camera;
			this.scene = scene;
			this.kernelRadius = 8;
			this.kernelSize = 32;
			this.kernel = [];
			this.noiseTexture = null;
			this.output = 0;
			this.minDistance = 0.005;
			this.maxDistance = 0.1;
			this._visibilityCache = new Map(); //

			this.generateSampleKernel();
			this.generateRandomKernelRotations(); // beauty render target

			const depthTexture = new THREE.DepthTexture();
			depthTexture.type = THREE.UnsignedShortType;
			this.beautyRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat
			} ); // normal render target with depth buffer

			this.normalRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				depthTexture: depthTexture
			} ); // ssao render target

			this.ssaoRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat
			} );
			this.blurRenderTarget = this.ssaoRenderTarget.clone(); // ssao material

			if ( THREE.SSAOShader === undefined ) {

				console.error( 'THREE.SSAOPass: The pass relies on THREE.SSAOShader.' );

			}

			this.ssaoMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAOShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAOShader.uniforms ),
				vertexShader: THREE.SSAOShader.vertexShader,
				fragmentShader: THREE.SSAOShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.ssaoMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
			this.ssaoMaterial.uniforms[ 'tNormal' ].value = this.normalRenderTarget.texture;
			this.ssaoMaterial.uniforms[ 'tDepth' ].value = this.normalRenderTarget.depthTexture;
			this.ssaoMaterial.uniforms[ 'tNoise' ].value = this.noiseTexture;
			this.ssaoMaterial.uniforms[ 'kernel' ].value = this.kernel;
			this.ssaoMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.ssaoMaterial.uniforms[ 'cameraFar' ].value = this.camera.far;
			this.ssaoMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height );
			this.ssaoMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssaoMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse ); // normal material

			this.normalMaterial = new THREE.MeshNormalMaterial();
			this.normalMaterial.blending = THREE.NoBlending; // blur material

			this.blurMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAOBlurShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAOBlurShader.uniforms ),
				vertexShader: THREE.SSAOBlurShader.vertexShader,
				fragmentShader: THREE.SSAOBlurShader.fragmentShader
			} );
			this.blurMaterial.uniforms[ 'tDiffuse' ].value = this.ssaoRenderTarget.texture;
			this.blurMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height ); // material for rendering the depth

			this.depthRenderMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSAODepthShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSAODepthShader.uniforms ),
				vertexShader: THREE.SSAODepthShader.vertexShader,
				fragmentShader: THREE.SSAODepthShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.depthRenderMaterial.uniforms[ 'tDepth' ].value = this.normalRenderTarget.depthTexture;
			this.depthRenderMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.depthRenderMaterial.uniforms[ 'cameraFar' ].value = this.camera.far; // material for rendering the content of a render target

			this.copyMaterial = new THREE.ShaderMaterial( {
				uniforms: THREE.UniformsUtils.clone( THREE.CopyShader.uniforms ),
				vertexShader: THREE.CopyShader.vertexShader,
				fragmentShader: THREE.CopyShader.fragmentShader,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				blendSrc: THREE.DstColorFactor,
				blendDst: THREE.ZeroFactor,
				blendEquation: THREE.AddEquation,
				blendSrcAlpha: THREE.DstAlphaFactor,
				blendDstAlpha: THREE.ZeroFactor,
				blendEquationAlpha: THREE.AddEquation
			} );
			this.fsQuad = new THREE.FullScreenQuad( null );
			this.originalClearColor = new THREE.Color();

		}

		dispose() {

			// dispose render targets
			this.beautyRenderTarget.dispose();
			this.normalRenderTarget.dispose();
			this.ssaoRenderTarget.dispose();
			this.blurRenderTarget.dispose(); // dispose materials

			this.normalMaterial.dispose();
			this.blurMaterial.dispose();
			this.copyMaterial.dispose();
			this.depthRenderMaterial.dispose(); // dipsose full screen quad

			this.fsQuad.dispose();

		}

		render( renderer, writeBuffer
			/*, readBuffer, deltaTime, maskActive */
		) {

			// render beauty
			renderer.setRenderTarget( this.beautyRenderTarget );
			renderer.clear();
			renderer.render( this.scene, this.camera ); // render normals and depth (honor only meshes, points and lines do not contribute to SSAO)

			this.overrideVisibility();
			this.renderOverride( renderer, this.normalMaterial, this.normalRenderTarget, 0x7777ff, 1.0 );
			this.restoreVisibility(); // render SSAO

			this.ssaoMaterial.uniforms[ 'kernelRadius' ].value = this.kernelRadius;
			this.ssaoMaterial.uniforms[ 'minDistance' ].value = this.minDistance;
			this.ssaoMaterial.uniforms[ 'maxDistance' ].value = this.maxDistance;
			this.renderPass( renderer, this.ssaoMaterial, this.ssaoRenderTarget ); // render blur

			this.renderPass( renderer, this.blurMaterial, this.blurRenderTarget ); // output result to screen

			switch ( this.output ) {

				case SSAOPass.OUTPUT.SSAO:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssaoRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Blur:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Beauty:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Depth:
					this.renderPass( renderer, this.depthRenderMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Normal:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.normalRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSAOPass.OUTPUT.Default:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget.texture;
					this.copyMaterial.blending = THREE.CustomBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				default:
					console.warn( 'THREE.SSAOPass: Unknown output type.' );

			}

		}

		renderPass( renderer, passMaterial, renderTarget, clearColor, clearAlpha ) {

			// save original state
			renderer.getClearColor( this.originalClearColor );
			const originalClearAlpha = renderer.getClearAlpha();
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget ); // setup pass state

			renderer.autoClear = false;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.fsQuad.material = passMaterial;
			this.fsQuad.render( renderer ); // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		renderOverride( renderer, overrideMaterial, renderTarget, clearColor, clearAlpha ) {

			renderer.getClearColor( this.originalClearColor );
			const originalClearAlpha = renderer.getClearAlpha();
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget );
			renderer.autoClear = false;
			clearColor = overrideMaterial.clearColor || clearColor;
			clearAlpha = overrideMaterial.clearAlpha || clearAlpha;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.scene.overrideMaterial = overrideMaterial;
			renderer.render( this.scene, this.camera );
			this.scene.overrideMaterial = null; // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		setSize( width, height ) {

			this.width = width;
			this.height = height;
			this.beautyRenderTarget.setSize( width, height );
			this.ssaoRenderTarget.setSize( width, height );
			this.normalRenderTarget.setSize( width, height );
			this.blurRenderTarget.setSize( width, height );
			this.ssaoMaterial.uniforms[ 'resolution' ].value.set( width, height );
			this.ssaoMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssaoMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse );
			this.blurMaterial.uniforms[ 'resolution' ].value.set( width, height );

		}

		generateSampleKernel() {

			const kernelSize = this.kernelSize;
			const kernel = this.kernel;

			for ( let i = 0; i < kernelSize; i ++ ) {

				const sample = new THREE.Vector3();
				sample.x = Math.random() * 2 - 1;
				sample.y = Math.random() * 2 - 1;
				sample.z = Math.random();
				sample.normalize();
				let scale = i / kernelSize;
				scale = THREE.MathUtils.lerp( 0.1, 1, scale * scale );
				sample.multiplyScalar( scale );
				kernel.push( sample );

			}

		}

		generateRandomKernelRotations() {

			const width = 4,
				height = 4;

			if ( THREE.SimplexNoise === undefined ) {

				console.error( 'THREE.SSAOPass: The pass relies on THREE.SimplexNoise.' );

			}

			const simplex = new THREE.SimplexNoise();
			const size = width * height;
			const data = new Float32Array( size * 4 );

			for ( let i = 0; i < size; i ++ ) {

				const stride = i * 4;
				const x = Math.random() * 2 - 1;
				const y = Math.random() * 2 - 1;
				const z = 0;
				const noise = simplex.noise3d( x, y, z );
				data[ stride ] = noise;
				data[ stride + 1 ] = noise;
				data[ stride + 2 ] = noise;
				data[ stride + 3 ] = 1;

			}

			this.noiseTexture = new THREE.DataTexture( data, width, height, THREE.RGBAFormat, THREE.FloatType );
			this.noiseTexture.wrapS = THREE.RepeatWrapping;
			this.noiseTexture.wrapT = THREE.RepeatWrapping;

		}

		overrideVisibility() {

			const scene = this.scene;
			const cache = this._visibilityCache;
			scene.traverse( function ( object ) {

				cache.set( object, object.visible );
				if ( object.isPoints || object.isLine ) object.visible = false;

			} );

		}

		restoreVisibility() {

			const scene = this.scene;
			const cache = this._visibilityCache;
			scene.traverse( function ( object ) {

				const visible = cache.get( object );
				object.visible = visible;

			} );
			cache.clear();

		}

	}

	SSAOPass.OUTPUT = {
		'Default': 0,
		'SSAO': 1,
		'Blur': 2,
		'Beauty': 3,
		'Depth': 4,
		'Normal': 5
	};

	THREE.SSAOPass = SSAOPass;

} )();

// --- three.js r129 examples/js/SSRShader.js ---
( function () {

	/**
 * References:
 * https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.html
 */

	var SSRShader = {
		defines: {
			MAX_STEP: 0,
			PERSPECTIVE_CAMERA: true,
			DISTANCE_ATTENUATION: true,
			FRESNEL: true,
			INFINITE_THICK: false,
			SELECTIVE: false
		},
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'tNormal': {
				value: null
			},
			'tMetalness': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'cameraProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'cameraInverseProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'opacity': {
				value: .5
			},
			'maxDistance': {
				value: 180
			},
			'cameraRange': {
				value: 0
			},
			'thickness': {
				value: .018
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}

	`,
		fragmentShader:
  /* glsl */
  `
		// precision highp float;
		precision highp sampler2D;
		varying vec2 vUv;
		uniform sampler2D tDepth;
		uniform sampler2D tNormal;
		uniform sampler2D tMetalness;
		uniform sampler2D tDiffuse;
		uniform float cameraRange;
		uniform vec2 resolution;
		uniform float opacity;
		uniform float cameraNear;
		uniform float cameraFar;
		uniform float maxDistance;
		uniform float thickness;
		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraInverseProjectionMatrix;
		#include <packing>
		float pointToLineDistance(vec3 x0, vec3 x1, vec3 x2) {
			//x0: point, x1: linePointA, x2: linePointB
			//https://mathworld.wolfram.com/Point-LineDistance3-Dimensional.html
			return length(cross(x0-x1,x0-x2))/length(x2-x1);
		}
		float pointPlaneDistance(vec3 point,vec3 planePoint,vec3 planeNormal){
			// https://mathworld.wolfram.com/Point-PlaneDistance.html
			//// https://en.wikipedia.org/wiki/Plane_(geometry)
			//// http://paulbourke.net/geometry/pointlineplane/
			float a=planeNormal.x,b=planeNormal.y,c=planeNormal.z;
			float x0=point.x,y0=point.y,z0=point.z;
			float x=planePoint.x,y=planePoint.y,z=planePoint.z;
			float d=-(a*x+b*y+c*z);
			float distance=(a*x0+b*y0+c*z0+d)/sqrt(a*a+b*b+c*c);
			return distance;
		}
		float getDepth( const in vec2 uv ) {
			return texture2D( tDepth, uv ).x;
		}
		float getViewZ( const in float depth ) {
			#ifdef PERSPECTIVE_CAMERA
				return perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
			#else
				return orthographicDepthToViewZ( depth, cameraNear, cameraFar );
			#endif
		}
		vec3 getViewPosition( const in vec2 uv, const in float depth/*clip space*/, const in float clipW ) {
			vec4 clipPosition = vec4( ( vec3( uv, depth ) - 0.5 ) * 2.0, 1.0 );//ndc
			clipPosition *= clipW; //clip
			return ( cameraInverseProjectionMatrix * clipPosition ).xyz;//view
		}
		vec3 getViewNormal( const in vec2 uv ) {
			return unpackRGBToNormal( texture2D( tNormal, uv ).xyz );
		}
		vec2 viewPositionToXY(vec3 viewPosition){
			vec2 xy;
			vec4 clip=cameraProjectionMatrix*vec4(viewPosition,1);
			xy=clip.xy;//clip
			float clipW=clip.w;
			xy/=clipW;//NDC
			xy=(xy+1.)/2.;//uv
			xy*=resolution;//screen
			return xy;
		}
		void main(){
			#ifdef SELECTIVE
				float metalness=texture2D(tMetalness,vUv).r;
				if(metalness==0.) return;
			#endif

			float depth = getDepth( vUv );
			float viewZ = getViewZ( depth );
			if(-viewZ>=cameraFar) return;

			float clipW = cameraProjectionMatrix[2][3] * viewZ+cameraProjectionMatrix[3][3];
			vec3 viewPosition=getViewPosition( vUv, depth, clipW );

			vec2 d0=gl_FragCoord.xy;
			vec2 d1;

			vec3 viewNormal=getViewNormal( vUv );

			#ifdef PERSPECTIVE_CAMERA
				vec3 viewIncidentDir=normalize(viewPosition);
				vec3 viewReflectDir=reflect(viewIncidentDir,viewNormal);
			#else
				vec3 viewIncidentDir=vec3(0,0,-1);
				vec3 viewReflectDir=reflect(viewIncidentDir,viewNormal);
			#endif

			float maxReflectRayLen=maxDistance/dot(-viewIncidentDir,viewNormal);
			// dot(a,b)==length(a)*length(b)*cos(theta) // https://www.mathsisfun.com/algebra/vectors-dot-product.html
			// if(a.isNormalized&&b.isNormalized) dot(a,b)==cos(theta)
			// maxDistance/maxReflectRayLen=cos(theta)
			// maxDistance/maxReflectRayLen==dot(a,b)
			// maxReflectRayLen==maxDistance/dot(a,b)

			vec3 d1viewPosition=viewPosition+viewReflectDir*maxReflectRayLen;
			#ifdef PERSPECTIVE_CAMERA
				if(d1viewPosition.z>-cameraNear){
					//https://tutorial.math.lamar.edu/Classes/CalcIII/EqnsOfLines.aspx
					float t=(-cameraNear-viewPosition.z)/viewReflectDir.z;
					d1viewPosition=viewPosition+viewReflectDir*t;
				}
			#endif
			d1=viewPositionToXY(d1viewPosition);

			float totalLen=length(d1-d0);
			float xLen=d1.x-d0.x;
			float yLen=d1.y-d0.y;
			float totalStep=max(abs(xLen),abs(yLen));
			float xSpan=xLen/totalStep;
			float ySpan=yLen/totalStep;
			for(float i=0.;i<float(MAX_STEP);i++){
				if(i>=totalStep) break;
				vec2 xy=vec2(d0.x+i*xSpan,d0.y+i*ySpan);
				if(xy.x<0.||xy.x>resolution.x||xy.y<0.||xy.y>resolution.y) break;
				float s=length(xy-d0)/totalLen;
				vec2 uv=xy/resolution;

				float d = getDepth(uv);
				float vZ = getViewZ( d );
				if(-vZ>=cameraFar) continue;
				float cW = cameraProjectionMatrix[2][3] * vZ+cameraProjectionMatrix[3][3];
				vec3 vP=getViewPosition( uv, d, cW );

				#ifdef PERSPECTIVE_CAMERA
					// https://www.comp.nus.edu.sg/~lowkl/publications/lowk_persp_interp_techrep.pdf
					float recipVPZ=1./viewPosition.z;
					float viewReflectRayZ=1./(recipVPZ+s*(1./d1viewPosition.z-recipVPZ));
				#else
					float viewReflectRayZ=viewPosition.z+s*(d1viewPosition.z-viewPosition.z);
				#endif

				// if(viewReflectRayZ>vZ) continue; // will cause "npm run make-screenshot webgl_postprocessing_ssr" high probability hang.
				// https://github.com/mrdoob/three.js/pull/21539#issuecomment-821061164
				if(viewReflectRayZ<=vZ){

					bool hit;
					#ifdef INFINITE_THICK
						hit=true;
					#else
						float away=pointToLineDistance(vP,viewPosition,d1viewPosition);

						float minThickness;
						vec2 xyNeighbor=xy;
						xyNeighbor.x+=1.;
						vec2 uvNeighbor=xyNeighbor/resolution;
						vec3 vPNeighbor=getViewPosition(uvNeighbor,d,cW);
						minThickness=vPNeighbor.x-vP.x;
						minThickness*=3.;
						float tk=max(minThickness,thickness);

						hit=away<=tk;
					#endif

					if(hit){
						vec3 vN=getViewNormal( uv );
						if(dot(viewReflectDir,vN)>=0.) continue;
						float distance=pointPlaneDistance(vP,viewPosition,viewNormal);
						if(distance>maxDistance) break;
						float op=opacity;
						#ifdef DISTANCE_ATTENUATION
							float ratio=1.-(distance/maxDistance);
							float attenuation=ratio*ratio;
							op=opacity*attenuation;
						#endif
						#ifdef FRESNEL
							float fresnelCoe=(dot(viewIncidentDir,viewReflectDir)+1.)/2.;
							op*=fresnelCoe;
						#endif
						vec4 reflectColor=texture2D(tDiffuse,uv);
						gl_FragColor.xyz=reflectColor.xyz;
						gl_FragColor.a=op;
						break;
					}
				}
			}
		}
	`
	};
	var SSRDepthShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tDepth': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}

	`,
		fragmentShader:
  /* glsl */
  `

		uniform sampler2D tDepth;

		uniform float cameraNear;
		uniform float cameraFar;

		varying vec2 vUv;

		#include <packing>

		float getLinearDepth( const in vec2 uv ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, uv ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, uv ).x;

			#endif

		}

		void main() {

			float depth = getLinearDepth( vUv );
			float d = 1.0 - depth;
			// d=(d-.999)*1000.;
			gl_FragColor = vec4( vec3( d ), 1.0 );

		}

	`
	};
	var SSRBlurShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'opacity': {
				value: .5
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}

	`,
		fragmentShader:
  /* glsl */
  `

		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		varying vec2 vUv;
		void main() {
			//reverse engineering from PhotoShop blur filter, then change coefficient

			vec2 texelSize = ( 1.0 / resolution );

			vec4 c=texture2D(tDiffuse,vUv);

			vec2 offset;

			offset=(vec2(-1,0))*texelSize;
			vec4 cl=texture2D(tDiffuse,vUv+offset);

			offset=(vec2(1,0))*texelSize;
			vec4 cr=texture2D(tDiffuse,vUv+offset);

			offset=(vec2(0,-1))*texelSize;
			vec4 cb=texture2D(tDiffuse,vUv+offset);

			offset=(vec2(0,1))*texelSize;
			vec4 ct=texture2D(tDiffuse,vUv+offset);

			// float coeCenter=.5;
			// float coeSide=.125;
			float coeCenter=.2;
			float coeSide=.2;
			float a=c.a*coeCenter+cl.a*coeSide+cr.a*coeSide+cb.a*coeSide+ct.a*coeSide;
			vec3 rgb=(c.rgb*c.a*coeCenter+cl.rgb*cl.a*coeSide+cr.rgb*cr.a*coeSide+cb.rgb*cb.a*coeSide+ct.rgb*ct.a*coeSide)/a;
			gl_FragColor=vec4(rgb,a);

		}
	`
	};

	THREE.SSRBlurShader = SSRBlurShader;
	THREE.SSRDepthShader = SSRDepthShader;
	THREE.SSRShader = SSRShader;

} )();

// --- three.js r129 examples/js/SSRPass.js ---
( function () {

	class SSRPass extends THREE.Pass {

		constructor( {
			renderer,
			scene,
			camera,
			width,
			height,
			selects,
			encoding,
			bouncing = false,
			morphTargets = false,
			groundReflector
		} ) {

			super();
			this.width = width !== undefined ? width : 512;
			this.height = height !== undefined ? height : 512;
			this.clear = true;
			this.renderer = renderer;
			this.scene = scene;
			this.camera = camera;
			this.groundReflector = groundReflector;
			this.opacity = THREE.SSRShader.uniforms.opacity.value;
			this.output = 0;
			this.maxDistance = THREE.SSRShader.uniforms.maxDistance.value;
			this.thickness = THREE.SSRShader.uniforms.thickness.value;
			this.encoding = encoding;
			this.tempColor = new THREE.Color();
			this._selects = selects;
			this.selective = Array.isArray( this._selects );
			Object.defineProperty( this, 'selects', {
				get() {

					return this._selects;

				},

				set( val ) {

					if ( this._selects === val ) return;
					this._selects = val;

					if ( Array.isArray( val ) ) {

						this.selective = true;
						this.ssrMaterial.defines.SELECTIVE = true;
						this.ssrMaterial.needsUpdate = true;

					} else {

						this.selective = false;
						this.ssrMaterial.defines.SELECTIVE = false;
						this.ssrMaterial.needsUpdate = true;

					}

				}

			} );
			this._bouncing = bouncing;
			Object.defineProperty( this, 'bouncing', {
				get() {

					return this._bouncing;

				},

				set( val ) {

					if ( this._bouncing === val ) return;
					this._bouncing = val;

					if ( val ) {

						this.ssrMaterial.uniforms[ 'tDiffuse' ].value = this.prevRenderTarget.texture;

					} else {

						this.ssrMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;

					}

				}

			} );
			this.blur = true;
			this._distanceAttenuation = THREE.SSRShader.defines.DISTANCE_ATTENUATION;
			Object.defineProperty( this, 'distanceAttenuation', {
				get() {

					return this._distanceAttenuation;

				},

				set( val ) {

					if ( this._distanceAttenuation === val ) return;
					this._distanceAttenuation = val;
					this.ssrMaterial.defines.DISTANCE_ATTENUATION = val;
					this.ssrMaterial.needsUpdate = true;

				}

			} );
			this._fresnel = THREE.SSRShader.defines.FRESNEL;
			Object.defineProperty( this, 'fresnel', {
				get() {

					return this._fresnel;

				},

				set( val ) {

					if ( this._fresnel === val ) return;
					this._fresnel = val;
					this.ssrMaterial.defines.FRESNEL = val;
					this.ssrMaterial.needsUpdate = true;

				}

			} );
			this._infiniteThick = THREE.SSRShader.defines.INFINITE_THICK;
			Object.defineProperty( this, 'infiniteThick', {
				get() {

					return this._infiniteThick;

				},

				set( val ) {

					if ( this._infiniteThick === val ) return;
					this._infiniteThick = val;
					this.ssrMaterial.defines.INFINITE_THICK = val;
					this.ssrMaterial.needsUpdate = true;

				}

			} ); // beauty render target with depth buffer

			const depthTexture = new THREE.DepthTexture();
			depthTexture.type = THREE.UnsignedShortType;
			depthTexture.minFilter = THREE.NearestFilter;
			depthTexture.magFilter = THREE.NearestFilter;
			this.beautyRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				depthTexture: depthTexture,
				depthBuffer: true
			} ); //for bouncing

			this.prevRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat
			} ); // normal render target

			this.normalRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.HalfFloatType
			} ); // metalness render target

			this.metalnessRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat
			} ); // ssr render target

			this.ssrRenderTarget = new THREE.WebGLRenderTarget( this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat
			} );
			this.blurRenderTarget = this.ssrRenderTarget.clone();
			this.blurRenderTarget2 = this.ssrRenderTarget.clone(); // this.blurRenderTarget3 = this.ssrRenderTarget.clone();
			// ssr material

			if ( THREE.SSRShader === undefined ) {

				console.error( 'THREE.SSRPass: The pass relies on THREE.SSRShader.' );

			}

			this.ssrMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSRShader.defines, {
					MAX_STEP: Math.sqrt( this.width * this.width + this.height * this.height )
				} ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSRShader.uniforms ),
				vertexShader: THREE.SSRShader.vertexShader,
				fragmentShader: THREE.SSRShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.ssrMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
			this.ssrMaterial.uniforms[ 'tNormal' ].value = this.normalRenderTarget.texture;
			this.ssrMaterial.defines.SELECTIVE = this.selective;
			this.ssrMaterial.needsUpdate = true;
			this.ssrMaterial.uniforms[ 'tMetalness' ].value = this.metalnessRenderTarget.texture;
			this.ssrMaterial.uniforms[ 'tDepth' ].value = this.beautyRenderTarget.depthTexture;
			this.ssrMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.ssrMaterial.uniforms[ 'cameraFar' ].value = this.camera.far;
			this.ssrMaterial.uniforms[ 'thickness' ].value = this.thickness;
			this.ssrMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height );
			this.ssrMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssrMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse ); // normal material

			this.normalMaterial = new THREE.MeshNormalMaterial( {
				morphTargets
			} );
			this.normalMaterial.blending = THREE.NoBlending; // metalnessOn material

			this.metalnessOnMaterial = new THREE.MeshBasicMaterial( {
				color: 'white'
			} ); // metalnessOff material

			this.metalnessOffMaterial = new THREE.MeshBasicMaterial( {
				color: 'black'
			} ); // blur material

			this.blurMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSRBlurShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSRBlurShader.uniforms ),
				vertexShader: THREE.SSRBlurShader.vertexShader,
				fragmentShader: THREE.SSRBlurShader.fragmentShader
			} );
			this.blurMaterial.uniforms[ 'tDiffuse' ].value = this.ssrRenderTarget.texture;
			this.blurMaterial.uniforms[ 'resolution' ].value.set( this.width, this.height ); // blur material 2

			this.blurMaterial2 = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSRBlurShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSRBlurShader.uniforms ),
				vertexShader: THREE.SSRBlurShader.vertexShader,
				fragmentShader: THREE.SSRBlurShader.fragmentShader
			} );
			this.blurMaterial2.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget.texture;
			this.blurMaterial2.uniforms[ 'resolution' ].value.set( this.width, this.height ); // // blur material 3
			// this.blurMaterial3 = new THREE.ShaderMaterial({
			//   defines: Object.assign({}, THREE.SSRBlurShader.defines),
			//   uniforms: THREE.UniformsUtils.clone(THREE.SSRBlurShader.uniforms),
			//   vertexShader: THREE.SSRBlurShader.vertexShader,
			//   fragmentShader: THREE.SSRBlurShader.fragmentShader
			// });
			// this.blurMaterial3.uniforms['tDiffuse'].value = this.blurRenderTarget2.texture;
			// this.blurMaterial3.uniforms['resolution'].value.set(this.width, this.height);
			// material for rendering the depth

			this.depthRenderMaterial = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, THREE.SSRDepthShader.defines ),
				uniforms: THREE.UniformsUtils.clone( THREE.SSRDepthShader.uniforms ),
				vertexShader: THREE.SSRDepthShader.vertexShader,
				fragmentShader: THREE.SSRDepthShader.fragmentShader,
				blending: THREE.NoBlending
			} );
			this.depthRenderMaterial.uniforms[ 'tDepth' ].value = this.beautyRenderTarget.depthTexture;
			this.depthRenderMaterial.uniforms[ 'cameraNear' ].value = this.camera.near;
			this.depthRenderMaterial.uniforms[ 'cameraFar' ].value = this.camera.far; // material for rendering the content of a render target

			this.copyMaterial = new THREE.ShaderMaterial( {
				uniforms: THREE.UniformsUtils.clone( THREE.CopyShader.uniforms ),
				vertexShader: THREE.CopyShader.vertexShader,
				fragmentShader: THREE.CopyShader.fragmentShader,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				blendSrc: THREE.SrcAlphaFactor,
				blendDst: THREE.OneMinusSrcAlphaFactor,
				blendEquation: THREE.AddEquation,
				blendSrcAlpha: THREE.SrcAlphaFactor,
				blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
				blendEquationAlpha: THREE.AddEquation // premultipliedAlpha:true,

			} );
			this.fsQuad = new THREE.FullScreenQuad( null );
			this.originalClearColor = new THREE.Color();

		}

		dispose() {

			// dispose render targets
			this.beautyRenderTarget.dispose();
			this.prevRenderTarget.dispose();
			this.normalRenderTarget.dispose();
			this.metalnessRenderTarget.dispose();
			this.ssrRenderTarget.dispose();
			this.blurRenderTarget.dispose();
			this.blurRenderTarget2.dispose(); // this.blurRenderTarget3.dispose();
			// dispose materials

			this.normalMaterial.dispose();
			this.metalnessOnMaterial.dispose();
			this.metalnessOffMaterial.dispose();
			this.blurMaterial.dispose();
			this.blurMaterial2.dispose();
			this.copyMaterial.dispose();
			this.depthRenderMaterial.dispose(); // dipsose full screen quad

			this.fsQuad.dispose();

		}

		render( renderer, writeBuffer
			/*, readBuffer, deltaTime, maskActive */
		) {

			// render beauty and depth
			if ( this.encoding ) this.beautyRenderTarget.texture.encoding = this.encoding;
			renderer.setRenderTarget( this.beautyRenderTarget );
			renderer.clear();

			if ( this.groundReflector ) {

				this.groundReflector.visible = false;
				this.groundReflector.doRender( this.renderer, this.scene, this.camera );
				this.groundReflector.visible = true;

			}

			renderer.render( this.scene, this.camera );
			if ( this.groundReflector ) this.groundReflector.visible = false; // render normals

			this.renderOverride( renderer, this.normalMaterial, this.normalRenderTarget, 0, 0 ); // render metalnesses

			if ( this.selective ) {

				this.renderMetalness( renderer, this.metalnessOnMaterial, this.metalnessRenderTarget, 0, 0 );

			} // render SSR


			this.ssrMaterial.uniforms[ 'opacity' ].value = this.opacity;
			this.ssrMaterial.uniforms[ 'maxDistance' ].value = this.maxDistance;
			this.ssrMaterial.uniforms[ 'thickness' ].value = this.thickness;
			this.renderPass( renderer, this.ssrMaterial, this.ssrRenderTarget ); // render blur

			if ( this.blur ) {

				this.renderPass( renderer, this.blurMaterial, this.blurRenderTarget );
				this.renderPass( renderer, this.blurMaterial2, this.blurRenderTarget2 ); // this.renderPass(renderer, this.blurMaterial3, this.blurRenderTarget3);

			} // output result to screen


			switch ( this.output ) {

				case SSRPass.OUTPUT.Default:
					if ( this.bouncing ) {

						this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
						this.copyMaterial.blending = THREE.NoBlending;
						this.renderPass( renderer, this.copyMaterial, this.prevRenderTarget );
						if ( this.blur ) this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget2.texture; else this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssrRenderTarget.texture;
						this.copyMaterial.blending = THREE.NormalBlending;
						this.renderPass( renderer, this.copyMaterial, this.prevRenderTarget );
						this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.prevRenderTarget.texture;
						this.copyMaterial.blending = THREE.NoBlending;
						this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );

					} else {

						this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
						this.copyMaterial.blending = THREE.NoBlending;
						this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
						if ( this.blur ) this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget2.texture; else this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssrRenderTarget.texture;
						this.copyMaterial.blending = THREE.NormalBlending;
						this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );

					}

					break;

				case SSRPass.OUTPUT.SSR:
					if ( this.blur ) this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget2.texture; else this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssrRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );

					if ( this.bouncing ) {

						if ( this.blur ) this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.blurRenderTarget2.texture; else this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
						this.copyMaterial.blending = THREE.NoBlending;
						this.renderPass( renderer, this.copyMaterial, this.prevRenderTarget );
						this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.ssrRenderTarget.texture;
						this.copyMaterial.blending = THREE.NormalBlending;
						this.renderPass( renderer, this.copyMaterial, this.prevRenderTarget );

					}

					break;

				case SSRPass.OUTPUT.Beauty:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.beautyRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSRPass.OUTPUT.Depth:
					this.renderPass( renderer, this.depthRenderMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSRPass.OUTPUT.Normal:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.normalRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				case SSRPass.OUTPUT.Metalness:
					this.copyMaterial.uniforms[ 'tDiffuse' ].value = this.metalnessRenderTarget.texture;
					this.copyMaterial.blending = THREE.NoBlending;
					this.renderPass( renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer );
					break;

				default:
					console.warn( 'THREE.SSRPass: Unknown output type.' );

			}

		}

		renderPass( renderer, passMaterial, renderTarget, clearColor, clearAlpha ) {

			// save original state
			this.originalClearColor.copy( renderer.getClearColor( this.tempColor ) );
			const originalClearAlpha = renderer.getClearAlpha( this.tempColor );
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget ); // setup pass state

			renderer.autoClear = false;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.fsQuad.material = passMaterial;
			this.fsQuad.render( renderer ); // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		renderOverride( renderer, overrideMaterial, renderTarget, clearColor, clearAlpha ) {

			this.originalClearColor.copy( renderer.getClearColor( this.tempColor ) );
			const originalClearAlpha = renderer.getClearAlpha( this.tempColor );
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget );
			renderer.autoClear = false;
			clearColor = overrideMaterial.clearColor || clearColor;
			clearAlpha = overrideMaterial.clearAlpha || clearAlpha;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.scene.overrideMaterial = overrideMaterial;
			renderer.render( this.scene, this.camera );
			this.scene.overrideMaterial = null; // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		renderMetalness( renderer, overrideMaterial, renderTarget, clearColor, clearAlpha ) {

			this.originalClearColor.copy( renderer.getClearColor( this.tempColor ) );
			const originalClearAlpha = renderer.getClearAlpha( this.tempColor );
			const originalAutoClear = renderer.autoClear;
			renderer.setRenderTarget( renderTarget );
			renderer.autoClear = false;
			clearColor = overrideMaterial.clearColor || clearColor;
			clearAlpha = overrideMaterial.clearAlpha || clearAlpha;

			if ( clearColor !== undefined && clearColor !== null ) {

				renderer.setClearColor( clearColor );
				renderer.setClearAlpha( clearAlpha || 0.0 );
				renderer.clear();

			}

			this.scene.traverseVisible( child => {

				child._SSRPassBackupMaterial = child.material;

				if ( this._selects.includes( child ) ) {

					child.material = this.metalnessOnMaterial;

				} else {

					child.material = this.metalnessOffMaterial;

				}

			} );
			renderer.render( this.scene, this.camera );
			this.scene.traverseVisible( child => {

				child.material = child._SSRPassBackupMaterial;

			} ); // restore original state

			renderer.autoClear = originalAutoClear;
			renderer.setClearColor( this.originalClearColor );
			renderer.setClearAlpha( originalClearAlpha );

		}

		setSize( width, height ) {

			this.width = width;
			this.height = height;
			this.ssrMaterial.defines.MAX_STEP = Math.sqrt( width * width + height * height );
			this.ssrMaterial.needsUpdate = true;
			this.beautyRenderTarget.setSize( width, height );
			this.prevRenderTarget.setSize( width, height );
			this.ssrRenderTarget.setSize( width, height );
			this.normalRenderTarget.setSize( width, height );
			this.metalnessRenderTarget.setSize( width, height );
			this.blurRenderTarget.setSize( width, height );
			this.blurRenderTarget2.setSize( width, height ); // this.blurRenderTarget3.setSize(width, height);

			this.ssrMaterial.uniforms[ 'resolution' ].value.set( width, height );
			this.ssrMaterial.uniforms[ 'cameraProjectionMatrix' ].value.copy( this.camera.projectionMatrix );
			this.ssrMaterial.uniforms[ 'cameraInverseProjectionMatrix' ].value.copy( this.camera.projectionMatrixInverse );
			this.blurMaterial.uniforms[ 'resolution' ].value.set( width, height );
			this.blurMaterial2.uniforms[ 'resolution' ].value.set( width, height );

		}

	}

	SSRPass.OUTPUT = {
		'Default': 0,
		'SSR': 1,
		'Beauty': 3,
		'Depth': 4,
		'Normal': 5,
		'Metalness': 7
	};

	THREE.SSRPass = SSRPass;

} )();

// --- three.js r129 examples/js/LuminosityHighPassShader.js ---
( function () {

	/**
 * Luminosity
 * http://en.wikipedia.org/wiki/Luminosity
 */

	const LuminosityHighPassShader = {
		shaderID: 'luminosityHighPass',
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'luminosityThreshold': {
				value: 1.0
			},
			'smoothWidth': {
				value: 1.0
			},
			'defaultColor': {
				value: new THREE.Color( 0x000000 )
			},
			'defaultOpacity': {
				value: 0.0
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			vec3 luma = vec3( 0.299, 0.587, 0.114 );

			float v = dot( texel.xyz, luma );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`
	};

	THREE.LuminosityHighPassShader = LuminosityHighPassShader;

} )();

// --- three.js r129 examples/js/UnrealBloomPass.js ---
( function () {

	/**
 * UnrealBloomPass is inspired by the bloom pass of Unreal Engine. It creates a
 * mip map chain of bloom textures and blurs them with different radii. Because
 * of the weighted combination of mips, and because larger blurs are done on
 * higher mips, this effect provides good quality and performance.
 *
 * Reference:
 * - https://docs.unrealengine.com/latest/INT/Engine/Rendering/PostProcessEffects/Bloom/
 */

	class UnrealBloomPass extends THREE.Pass {

		constructor( resolution, strength, radius, threshold ) {

			super();
			this.strength = strength !== undefined ? strength : 1;
			this.radius = radius;
			this.threshold = threshold;
			this.resolution = resolution !== undefined ? new THREE.Vector2( resolution.x, resolution.y ) : new THREE.Vector2( 256, 256 ); // create color only once here, reuse it later inside the render function

			this.clearColor = new THREE.Color( 0, 0, 0 ); // render targets

			const pars = {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				format: THREE.RGBAFormat,
				type: THREE.HalfFloatType
			};
			this.renderTargetsHorizontal = [];
			this.renderTargetsVertical = [];
			this.nMips = 5;
			let resx = Math.round( this.resolution.x / 2 );
			let resy = Math.round( this.resolution.y / 2 );
			this.renderTargetBright = new THREE.WebGLRenderTarget( resx, resy, pars );
			this.renderTargetBright.texture.name = 'UnrealBloomPass.bright';
			this.renderTargetBright.texture.generateMipmaps = false;

			for ( let i = 0; i < this.nMips; i ++ ) {

				const renderTargetHorizonal = new THREE.WebGLRenderTarget( resx, resy, pars );
				renderTargetHorizonal.texture.name = 'UnrealBloomPass.h' + i;
				renderTargetHorizonal.texture.generateMipmaps = false;
				this.renderTargetsHorizontal.push( renderTargetHorizonal );
				const renderTargetVertical = new THREE.WebGLRenderTarget( resx, resy, pars );
				renderTargetVertical.texture.name = 'UnrealBloomPass.v' + i;
				renderTargetVertical.texture.generateMipmaps = false;
				this.renderTargetsVertical.push( renderTargetVertical );
				resx = Math.round( resx / 2 );
				resy = Math.round( resy / 2 );

			} // luminosity high pass material


			if ( THREE.LuminosityHighPassShader === undefined ) console.error( 'THREE.UnrealBloomPass relies on THREE.LuminosityHighPassShader' );
			const highPassShader = THREE.LuminosityHighPassShader;
			this.highPassUniforms = THREE.UniformsUtils.clone( highPassShader.uniforms );
			this.highPassUniforms[ 'luminosityThreshold' ].value = threshold;
			this.highPassUniforms[ 'smoothWidth' ].value = 0.01;
			this.materialHighPassFilter = new THREE.ShaderMaterial( {
				uniforms: this.highPassUniforms,
				vertexShader: highPassShader.vertexShader,
				fragmentShader: highPassShader.fragmentShader,
				defines: {}
			} ); // Gaussian Blur Materials

			this.separableBlurMaterials = [];
			const kernelSizeArray = [ 3, 5, 7, 9, 11 ];
			resx = Math.round( this.resolution.x / 2 );
			resy = Math.round( this.resolution.y / 2 );

			for ( let i = 0; i < this.nMips; i ++ ) {

				this.separableBlurMaterials.push( this.getSeperableBlurMaterial( kernelSizeArray[ i ] ) );
				this.separableBlurMaterials[ i ].uniforms[ 'texSize' ].value = new THREE.Vector2( resx, resy );
				resx = Math.round( resx / 2 );
				resy = Math.round( resy / 2 );

			} // Composite material


			this.compositeMaterial = this.getCompositeMaterial( this.nMips );
			this.compositeMaterial.uniforms[ 'blurTexture1' ].value = this.renderTargetsVertical[ 0 ].texture;
			this.compositeMaterial.uniforms[ 'blurTexture2' ].value = this.renderTargetsVertical[ 1 ].texture;
			this.compositeMaterial.uniforms[ 'blurTexture3' ].value = this.renderTargetsVertical[ 2 ].texture;
			this.compositeMaterial.uniforms[ 'blurTexture4' ].value = this.renderTargetsVertical[ 3 ].texture;
			this.compositeMaterial.uniforms[ 'blurTexture5' ].value = this.renderTargetsVertical[ 4 ].texture;
			this.compositeMaterial.uniforms[ 'bloomStrength' ].value = strength;
			this.compositeMaterial.uniforms[ 'bloomRadius' ].value = 0.1;
			this.compositeMaterial.needsUpdate = true;
			const bloomFactors = [ 1.0, 0.8, 0.6, 0.4, 0.2 ];
			this.compositeMaterial.uniforms[ 'bloomFactors' ].value = bloomFactors;
			this.bloomTintColors = [ new THREE.Vector3( 1, 1, 1 ), new THREE.Vector3( 1, 1, 1 ), new THREE.Vector3( 1, 1, 1 ), new THREE.Vector3( 1, 1, 1 ), new THREE.Vector3( 1, 1, 1 ) ];
			this.compositeMaterial.uniforms[ 'bloomTintColors' ].value = this.bloomTintColors; // copy material

			if ( THREE.CopyShader === undefined ) {

				console.error( 'THREE.UnrealBloomPass relies on THREE.CopyShader' );

			}

			const copyShader = THREE.CopyShader;
			this.copyUniforms = THREE.UniformsUtils.clone( copyShader.uniforms );
			this.copyUniforms[ 'opacity' ].value = 1.0;
			this.materialCopy = new THREE.ShaderMaterial( {
				uniforms: this.copyUniforms,
				vertexShader: copyShader.vertexShader,
				fragmentShader: copyShader.fragmentShader,
				blending: THREE.AdditiveBlending,
				depthTest: false,
				depthWrite: false,
				transparent: true
			} );
			this.enabled = true;
			this.needsSwap = false;
			this._oldClearColor = new THREE.Color();
			this.oldClearAlpha = 1;
			this.basic = new THREE.MeshBasicMaterial();
			this.fsQuad = new THREE.FullScreenQuad( null );

		}

		dispose() {

			for ( let i = 0; i < this.renderTargetsHorizontal.length; i ++ ) {

				this.renderTargetsHorizontal[ i ].dispose();

			}

			for ( let i = 0; i < this.renderTargetsVertical.length; i ++ ) {

				this.renderTargetsVertical[ i ].dispose();

			}

			this.renderTargetBright.dispose();

		}

		setSize( width, height ) {

			let resx = Math.round( width / 2 );
			let resy = Math.round( height / 2 );
			this.renderTargetBright.setSize( resx, resy );

			for ( let i = 0; i < this.nMips; i ++ ) {

				this.renderTargetsHorizontal[ i ].setSize( resx, resy );
				this.renderTargetsVertical[ i ].setSize( resx, resy );
				this.separableBlurMaterials[ i ].uniforms[ 'texSize' ].value = new THREE.Vector2( resx, resy );
				resx = Math.round( resx / 2 );
				resy = Math.round( resy / 2 );

			}

		}

		render( renderer, writeBuffer, readBuffer, deltaTime, maskActive ) {

			renderer.getClearColor( this._oldClearColor );
			this.oldClearAlpha = renderer.getClearAlpha();
			const oldAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			renderer.setClearColor( this.clearColor, 0 );
			if ( maskActive ) renderer.state.buffers.stencil.setTest( false ); // Render input to screen

			if ( this.renderToScreen ) {

				this.fsQuad.material = this.basic;
				this.basic.map = readBuffer.texture;
				renderer.setRenderTarget( null );
				renderer.clear();
				this.fsQuad.render( renderer );

			} // 1. Extract Bright Areas


			this.highPassUniforms[ 'tDiffuse' ].value = readBuffer.texture;
			this.highPassUniforms[ 'luminosityThreshold' ].value = this.threshold;
			this.fsQuad.material = this.materialHighPassFilter;
			renderer.setRenderTarget( this.renderTargetBright );
			renderer.clear();
			this.fsQuad.render( renderer ); // 2. Blur All the mips progressively

			let inputRenderTarget = this.renderTargetBright;

			for ( let i = 0; i < this.nMips; i ++ ) {

				this.fsQuad.material = this.separableBlurMaterials[ i ];
				this.separableBlurMaterials[ i ].uniforms[ 'colorTexture' ].value = inputRenderTarget.texture;
				this.separableBlurMaterials[ i ].uniforms[ 'direction' ].value = UnrealBloomPass.BlurDirectionX;
				renderer.setRenderTarget( this.renderTargetsHorizontal[ i ] );
				renderer.clear();
				this.fsQuad.render( renderer );
				this.separableBlurMaterials[ i ].uniforms[ 'colorTexture' ].value = this.renderTargetsHorizontal[ i ].texture;
				this.separableBlurMaterials[ i ].uniforms[ 'direction' ].value = UnrealBloomPass.BlurDirectionY;
				renderer.setRenderTarget( this.renderTargetsVertical[ i ] );
				renderer.clear();
				this.fsQuad.render( renderer );
				inputRenderTarget = this.renderTargetsVertical[ i ];

			} // Composite All the mips


			this.fsQuad.material = this.compositeMaterial;
			this.compositeMaterial.uniforms[ 'bloomStrength' ].value = this.strength;
			this.compositeMaterial.uniforms[ 'bloomRadius' ].value = this.radius;
			this.compositeMaterial.uniforms[ 'bloomTintColors' ].value = this.bloomTintColors;
			renderer.setRenderTarget( this.renderTargetsHorizontal[ 0 ] );
			renderer.clear();
			this.fsQuad.render( renderer ); // Blend it additively over the input texture

			this.fsQuad.material = this.materialCopy;
			this.copyUniforms[ 'tDiffuse' ].value = this.renderTargetsHorizontal[ 0 ].texture;
			if ( maskActive ) renderer.state.buffers.stencil.setTest( true );

			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );
				this.fsQuad.render( renderer );

			} else {

				renderer.setRenderTarget( readBuffer );
				this.fsQuad.render( renderer );

			} // Restore renderer settings


			renderer.setClearColor( this._oldClearColor, this.oldClearAlpha );
			renderer.autoClear = oldAutoClear;

		}

		getSeperableBlurMaterial( kernelRadius ) {

			return new THREE.ShaderMaterial( {
				defines: {
					'KERNEL_RADIUS': kernelRadius,
					'SIGMA': kernelRadius
				},
				uniforms: {
					'colorTexture': {
						value: null
					},
					'texSize': {
						value: new THREE.Vector2( 0.5, 0.5 )
					},
					'direction': {
						value: new THREE.Vector2( 0.5, 0.5 )
					}
				},
				vertexShader: `varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,
				fragmentShader: `#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 texSize;
				uniform vec2 direction;

				float gaussianPdf(in float x, in float sigma) {
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
				}
				void main() {
					vec2 invSize = 1.0 / texSize;
					float fSigma = float(SIGMA);
					float weightSum = gaussianPdf(0.0, fSigma);
					vec3 diffuseSum = texture2D( colorTexture, vUv).rgb * weightSum;
					for( int i = 1; i < KERNEL_RADIUS; i ++ ) {
						float x = float(i);
						float w = gaussianPdf(x, fSigma);
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset).rgb;
						diffuseSum += (sample1 + sample2) * w;
						weightSum += 2.0 * w;
					}
					gl_FragColor = vec4(diffuseSum/weightSum, 1.0);
				}`
			} );

		}

		getCompositeMaterial( nMips ) {

			return new THREE.ShaderMaterial( {
				defines: {
					'NUM_MIPS': nMips
				},
				uniforms: {
					'blurTexture1': {
						value: null
					},
					'blurTexture2': {
						value: null
					},
					'blurTexture3': {
						value: null
					},
					'blurTexture4': {
						value: null
					},
					'blurTexture5': {
						value: null
					},
					'dirtTexture': {
						value: null
					},
					'bloomStrength': {
						value: 1.0
					},
					'bloomFactors': {
						value: null
					},
					'bloomTintColors': {
						value: null
					},
					'bloomRadius': {
						value: 0.0
					}
				},
				vertexShader: `varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,
				fragmentShader: `varying vec2 vUv;
				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform sampler2D dirtTexture;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor(const in float factor) {
					float mirrorFactor = 1.2 - factor;
					return mix(factor, mirrorFactor, bloomRadius);
				}

				void main() {
					gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
						lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
						lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
						lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
						lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );
				}`
			} );

		}

	}

	UnrealBloomPass.BlurDirectionX = new THREE.Vector2( 1.0, 0.0 );
	UnrealBloomPass.BlurDirectionY = new THREE.Vector2( 0.0, 1.0 );

	THREE.UnrealBloomPass = UnrealBloomPass;

} )();

// --- three.js r129 examples/js/BokehShader.js ---
( function () {

	/**
 * Depth-of-field shader with bokeh
 * ported from GLSL shader by Martins Upitis
 * http://artmartinsh.blogspot.com/2010/02/glsl-lens-blur-filter-with-bokeh.html
 */
	const BokehShader = {
		defines: {
			'DEPTH_PACKING': 1,
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tColor': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'focus': {
				value: 1.0
			},
			'aspect': {
				value: 1.0
			},
			'aperture': {
				value: 0.025
			},
			'maxblur': {
				value: 0.01
			},
			'nearClip': {
				value: 1.0
			},
			'farClip': {
				value: 1000.0
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader:
  /* glsl */
  `

		#include <common>

		varying vec2 vUv;

		uniform sampler2D tColor;
		uniform sampler2D tDepth;

		uniform float maxblur; // max blur amount
		uniform float aperture; // aperture - bigger values for shallower depth of field

		uniform float nearClip;
		uniform float farClip;

		uniform float focus;
		uniform float aspect;

		#include <packing>

		float getDepth( const in vec2 screenPosition ) {
			#if DEPTH_PACKING == 1
			return unpackRGBAToDepth( texture2D( tDepth, screenPosition ) );
			#else
			return texture2D( tDepth, screenPosition ).x;
			#endif
		}

		float getViewZ( const in float depth ) {
			#if PERSPECTIVE_CAMERA == 1
			return perspectiveDepthToViewZ( depth, nearClip, farClip );
			#else
			return orthographicDepthToViewZ( depth, nearClip, farClip );
			#endif
		}


		void main() {

			vec2 aspectcorrect = vec2( 1.0, aspect );

			float viewZ = getViewZ( getDepth( vUv ) );

			float factor = ( focus + viewZ ); // viewZ is <= 0, so this is a difference equation

			vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblur, maxblur ) );

			vec2 dofblur9 = dofblur * 0.9;
			vec2 dofblur7 = dofblur * 0.7;
			vec2 dofblur4 = dofblur * 0.4;

			vec4 col = vec4( 0.0 );

			col += texture2D( tColor, vUv.xy );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.15,  0.37 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.37,  0.15 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.40,  0.0  ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.37, -0.15 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.15, -0.37 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.15,  0.37 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.37,  0.15 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.37, -0.15 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.15, -0.37 ) * aspectcorrect ) * dofblur );

			col += texture2D( tColor, vUv.xy + ( vec2(  0.15,  0.37 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.37,  0.15 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.37, -0.15 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.15, -0.37 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.15,  0.37 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.37,  0.15 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.37, -0.15 ) * aspectcorrect ) * dofblur9 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.15, -0.37 ) * aspectcorrect ) * dofblur9 );

			col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.40,  0.0  ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur7 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur7 );

			col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.4,   0.0  ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur4 );
			col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur4 );

			gl_FragColor = col / 41.0;
			gl_FragColor.a = 1.0;

		}`
	};

	THREE.BokehShader = BokehShader;

} )();

// --- three.js r129 examples/js/BokehPass.js ---
( function () {

	/**
 * Depth-of-field post-process with bokeh shader
 */

	class BokehPass extends THREE.Pass {

		constructor( scene, camera, params ) {

			super();
			this.scene = scene;
			this.camera = camera;
			const focus = params.focus !== undefined ? params.focus : 1.0;
			const aspect = params.aspect !== undefined ? params.aspect : camera.aspect;
			const aperture = params.aperture !== undefined ? params.aperture : 0.025;
			const maxblur = params.maxblur !== undefined ? params.maxblur : 1.0; // render targets

			const width = params.width || window.innerWidth || 1;
			const height = params.height || window.innerHeight || 1;
			this.renderTargetDepth = new THREE.WebGLRenderTarget( width, height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter
			} );
			this.renderTargetDepth.texture.name = 'BokehPass.depth'; // depth material

			this.materialDepth = new THREE.MeshDepthMaterial();
			this.materialDepth.depthPacking = THREE.RGBADepthPacking;
			this.materialDepth.blending = THREE.NoBlending; // bokeh material

			if ( THREE.BokehShader === undefined ) {

				console.error( 'THREE.BokehPass relies on THREE.BokehShader' );

			}

			const bokehShader = THREE.BokehShader;
			const bokehUniforms = THREE.UniformsUtils.clone( bokehShader.uniforms );
			bokehUniforms[ 'tDepth' ].value = this.renderTargetDepth.texture;
			bokehUniforms[ 'focus' ].value = focus;
			bokehUniforms[ 'aspect' ].value = aspect;
			bokehUniforms[ 'aperture' ].value = aperture;
			bokehUniforms[ 'maxblur' ].value = maxblur;
			bokehUniforms[ 'nearClip' ].value = camera.near;
			bokehUniforms[ 'farClip' ].value = camera.far;
			this.materialBokeh = new THREE.ShaderMaterial( {
				defines: Object.assign( {}, bokehShader.defines ),
				uniforms: bokehUniforms,
				vertexShader: bokehShader.vertexShader,
				fragmentShader: bokehShader.fragmentShader
			} );
			this.uniforms = bokehUniforms;
			this.needsSwap = false;
			this.fsQuad = new THREE.FullScreenQuad( this.materialBokeh );
			this._oldClearColor = new THREE.Color();

		}

		render( renderer, writeBuffer, readBuffer
			/*, deltaTime, maskActive*/
		) {

			// Render depth into texture
			this.scene.overrideMaterial = this.materialDepth;
			renderer.getClearColor( this._oldClearColor );
			const oldClearAlpha = renderer.getClearAlpha();
			const oldAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			renderer.setClearColor( 0xffffff );
			renderer.setClearAlpha( 1.0 );
			renderer.setRenderTarget( this.renderTargetDepth );
			renderer.clear();
			renderer.render( this.scene, this.camera ); // Render bokeh composite

			this.uniforms[ 'tColor' ].value = readBuffer.texture;
			this.uniforms[ 'nearClip' ].value = this.camera.near;
			this.uniforms[ 'farClip' ].value = this.camera.far;

			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );
				this.fsQuad.render( renderer );

			} else {

				renderer.setRenderTarget( writeBuffer );
				renderer.clear();
				this.fsQuad.render( renderer );

			}

			this.scene.overrideMaterial = null;
			renderer.setClearColor( this._oldClearColor );
			renderer.setClearAlpha( oldClearAlpha );
			renderer.autoClear = oldAutoClear;

		}

	}

	THREE.BokehPass = BokehPass;

} )();

// --- three.js r129 examples/js/FXAAShader.js ---
( function () {

	/**
 * NVIDIA FXAA by Timothy Lottes
 * http://timothylottes.blogspot.com/2011/06/fxaa3-source-released.html
 * - WebGL port by @supereggbert
 * http://www.glge.org/demos/fxaa/
 */

	const FXAAShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2( 1 / 1024, 1 / 512 )
			}
		},
		vertexShader:
  /* glsl */
  `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: // FXAA 3.11 implementation by NVIDIA, ported to WebGL by Agost Biro (biro@archilogic.com)
		//----------------------------------------------------------------------------------
		// File:				es3-kepler\FXAA\assets\shaders/FXAA_DefaultES.frag
		// SDK Version: v3.00
		// Email:			 gameworks@nvidia.com
		// Site:				http://developer.nvidia.com/
		//
		// Copyright (c) 2014-2015, NVIDIA CORPORATION. All rights reserved.
		//
		// Redistribution and use in source and binary forms, with or without
		// modification, are permitted provided that the following conditions
		// are met:
		//	* Redistributions of source code must retain the above copyright
		//		notice, this list of conditions and the following disclaimer.
		//	* Redistributions in binary form must reproduce the above copyright
		//		notice, this list of conditions and the following disclaimer in the
		//		documentation and/or other materials provided with the distribution.
		//	* Neither the name of NVIDIA CORPORATION nor the names of its
		//		contributors may be used to endorse or promote products derived
		//		from this software without specific prior written permission.
		//
		// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS\'\' AND ANY
		// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
		// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
		// PURPOSE ARE DISCLAIMED.	IN NO EVENT SHALL THE COPYRIGHT OWNER OR
		// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
		// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
		// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
		// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
		// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
		// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
		// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
		//
		//----------------------------------------------------------------------------------

  /* glsl */
  `

		precision highp float;

		uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		#define FXAA_PC 1
		#define FXAA_GLSL_100 1
		#define FXAA_QUALITY_PRESET 12

		#define FXAA_GREEN_AS_LUMA 1

		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_PC_CONSOLE
				//
				// The console algorithm for PC is included
				// for developers targeting really low spec machines.
				// Likely better to just run FXAA_PC, and use a really low preset.
				//
				#define FXAA_PC_CONSOLE 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GLSL_120
				#define FXAA_GLSL_120 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GLSL_130
				#define FXAA_GLSL_130 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_3
				#define FXAA_HLSL_3 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_4
				#define FXAA_HLSL_4 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_HLSL_5
				#define FXAA_HLSL_5 0
		#endif
		/*==========================================================================*/
		#ifndef FXAA_GREEN_AS_LUMA
				//
				// For those using non-linear color,
				// and either not able to get luma in alpha, or not wanting to,
				// this enables FXAA to run using green as a proxy for luma.
				// So with this enabled, no need to pack luma in alpha.
				//
				// This will turn off AA on anything which lacks some amount of green.
				// Pure red and blue or combination of only R and B, will get no AA.
				//
				// Might want to lower the settings for both,
				//		fxaaConsoleEdgeThresholdMin
				//		fxaaQualityEdgeThresholdMin
				// In order to insure AA does not get turned off on colors
				// which contain a minor amount of green.
				//
				// 1 = On.
				// 0 = Off.
				//
				#define FXAA_GREEN_AS_LUMA 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_EARLY_EXIT
				//
				// Controls algorithm\'s early exit path.
				// On PS3 turning this ON adds 2 cycles to the shader.
				// On 360 turning this OFF adds 10ths of a millisecond to the shader.
				// Turning this off on console will result in a more blurry image.
				// So this defaults to on.
				//
				// 1 = On.
				// 0 = Off.
				//
				#define FXAA_EARLY_EXIT 1
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_DISCARD
				//
				// Only valid for PC OpenGL currently.
				// Probably will not work when FXAA_GREEN_AS_LUMA = 1.
				//
				// 1 = Use discard on pixels which don\'t need AA.
				//		 For APIs which enable concurrent TEX+ROP from same surface.
				// 0 = Return unchanged color on pixels which don\'t need AA.
				//
				#define FXAA_DISCARD 0
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_FAST_PIXEL_OFFSET
				//
				// Used for GLSL 120 only.
				//
				// 1 = GL API supports fast pixel offsets
				// 0 = do not use fast pixel offsets
				//
				#ifdef GL_EXT_gpu_shader4
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifdef GL_NV_gpu_shader5
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifdef GL_ARB_gpu_shader5
						#define FXAA_FAST_PIXEL_OFFSET 1
				#endif
				#ifndef FXAA_FAST_PIXEL_OFFSET
						#define FXAA_FAST_PIXEL_OFFSET 0
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#ifndef FXAA_GATHER4_ALPHA
				//
				// 1 = API supports gather4 on alpha channel.
				// 0 = API does not support gather4 on alpha channel.
				//
				#if (FXAA_HLSL_5 == 1)
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifdef GL_ARB_gpu_shader5
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifdef GL_NV_gpu_shader5
						#define FXAA_GATHER4_ALPHA 1
				#endif
				#ifndef FXAA_GATHER4_ALPHA
						#define FXAA_GATHER4_ALPHA 0
				#endif
		#endif


		/*============================================================================
														FXAA QUALITY - TUNING KNOBS
		------------------------------------------------------------------------------
		NOTE the other tuning knobs are now in the shader function inputs!
		============================================================================*/
		#ifndef FXAA_QUALITY_PRESET
				//
				// Choose the quality preset.
				// This needs to be compiled into the shader as it effects code.
				// Best option to include multiple presets is to
				// in each shader define the preset, then include this file.
				//
				// OPTIONS
				// -----------------------------------------------------------------------
				// 10 to 15 - default medium dither (10=fastest, 15=highest quality)
				// 20 to 29 - less dither, more expensive (20=fastest, 29=highest quality)
				// 39			 - no dither, very expensive
				//
				// NOTES
				// -----------------------------------------------------------------------
				// 12 = slightly faster then FXAA 3.9 and higher edge quality (default)
				// 13 = about same speed as FXAA 3.9 and better than 12
				// 23 = closest to FXAA 3.9 visually and performance wise
				//	_ = the lowest digit is directly related to performance
				// _	= the highest digit is directly related to style
				//
				#define FXAA_QUALITY_PRESET 12
		#endif


		/*============================================================================

															 FXAA QUALITY - PRESETS

		============================================================================*/

		/*============================================================================
												 FXAA QUALITY - MEDIUM DITHER PRESETS
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 10)
				#define FXAA_QUALITY_PS 3
				#define FXAA_QUALITY_P0 1.5
				#define FXAA_QUALITY_P1 3.0
				#define FXAA_QUALITY_P2 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 11)
				#define FXAA_QUALITY_PS 4
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 3.0
				#define FXAA_QUALITY_P3 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 12)
				#define FXAA_QUALITY_PS 5
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 4.0
				#define FXAA_QUALITY_P4 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 13)
				#define FXAA_QUALITY_PS 6
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 4.0
				#define FXAA_QUALITY_P5 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 14)
				#define FXAA_QUALITY_PS 7
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 4.0
				#define FXAA_QUALITY_P6 12.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 15)
				#define FXAA_QUALITY_PS 8
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 4.0
				#define FXAA_QUALITY_P7 12.0
		#endif

		/*============================================================================
												 FXAA QUALITY - LOW DITHER PRESETS
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 20)
				#define FXAA_QUALITY_PS 3
				#define FXAA_QUALITY_P0 1.5
				#define FXAA_QUALITY_P1 2.0
				#define FXAA_QUALITY_P2 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 21)
				#define FXAA_QUALITY_PS 4
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 22)
				#define FXAA_QUALITY_PS 5
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 23)
				#define FXAA_QUALITY_PS 6
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 24)
				#define FXAA_QUALITY_PS 7
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 3.0
				#define FXAA_QUALITY_P6 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 25)
				#define FXAA_QUALITY_PS 8
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 4.0
				#define FXAA_QUALITY_P7 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 26)
				#define FXAA_QUALITY_PS 9
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 4.0
				#define FXAA_QUALITY_P8 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 27)
				#define FXAA_QUALITY_PS 10
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 4.0
				#define FXAA_QUALITY_P9 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 28)
				#define FXAA_QUALITY_PS 11
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 4.0
				#define FXAA_QUALITY_P10 8.0
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_QUALITY_PRESET == 29)
				#define FXAA_QUALITY_PS 12
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.5
				#define FXAA_QUALITY_P2 2.0
				#define FXAA_QUALITY_P3 2.0
				#define FXAA_QUALITY_P4 2.0
				#define FXAA_QUALITY_P5 2.0
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 2.0
				#define FXAA_QUALITY_P10 4.0
				#define FXAA_QUALITY_P11 8.0
		#endif

		/*============================================================================
												 FXAA QUALITY - EXTREME QUALITY
		============================================================================*/
		#if (FXAA_QUALITY_PRESET == 39)
				#define FXAA_QUALITY_PS 12
				#define FXAA_QUALITY_P0 1.0
				#define FXAA_QUALITY_P1 1.0
				#define FXAA_QUALITY_P2 1.0
				#define FXAA_QUALITY_P3 1.0
				#define FXAA_QUALITY_P4 1.0
				#define FXAA_QUALITY_P5 1.5
				#define FXAA_QUALITY_P6 2.0
				#define FXAA_QUALITY_P7 2.0
				#define FXAA_QUALITY_P8 2.0
				#define FXAA_QUALITY_P9 2.0
				#define FXAA_QUALITY_P10 4.0
				#define FXAA_QUALITY_P11 8.0
		#endif



		/*============================================================================

																		API PORTING

		============================================================================*/
		#if (FXAA_GLSL_100 == 1) || (FXAA_GLSL_120 == 1) || (FXAA_GLSL_130 == 1)
				#define FxaaBool bool
				#define FxaaDiscard discard
				#define FxaaFloat float
				#define FxaaFloat2 vec2
				#define FxaaFloat3 vec3
				#define FxaaFloat4 vec4
				#define FxaaHalf float
				#define FxaaHalf2 vec2
				#define FxaaHalf3 vec3
				#define FxaaHalf4 vec4
				#define FxaaInt2 ivec2
				#define FxaaSat(x) clamp(x, 0.0, 1.0)
				#define FxaaTex sampler2D
		#else
				#define FxaaBool bool
				#define FxaaDiscard clip(-1)
				#define FxaaFloat float
				#define FxaaFloat2 float2
				#define FxaaFloat3 float3
				#define FxaaFloat4 float4
				#define FxaaHalf half
				#define FxaaHalf2 half2
				#define FxaaHalf3 half3
				#define FxaaHalf4 half4
				#define FxaaSat(x) saturate(x)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_100 == 1)
			#define FxaaTexTop(t, p) texture2D(t, p, 0.0)
			#define FxaaTexOff(t, p, o, r) texture2D(t, p + (o * r), 0.0)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_120 == 1)
				// Requires,
				//	#version 120
				// And at least,
				//	#extension GL_EXT_gpu_shader4 : enable
				//	(or set FXAA_FAST_PIXEL_OFFSET 1 to work like DX9)
				#define FxaaTexTop(t, p) texture2DLod(t, p, 0.0)
				#if (FXAA_FAST_PIXEL_OFFSET == 1)
						#define FxaaTexOff(t, p, o, r) texture2DLodOffset(t, p, 0.0, o)
				#else
						#define FxaaTexOff(t, p, o, r) texture2DLod(t, p + (o * r), 0.0)
				#endif
				#if (FXAA_GATHER4_ALPHA == 1)
						// use #extension GL_ARB_gpu_shader5 : enable
						#define FxaaTexAlpha4(t, p) textureGather(t, p, 3)
						#define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)
						#define FxaaTexGreen4(t, p) textureGather(t, p, 1)
						#define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_GLSL_130 == 1)
				// Requires "#version 130" or better
				#define FxaaTexTop(t, p) textureLod(t, p, 0.0)
				#define FxaaTexOff(t, p, o, r) textureLodOffset(t, p, 0.0, o)
				#if (FXAA_GATHER4_ALPHA == 1)
						// use #extension GL_ARB_gpu_shader5 : enable
						#define FxaaTexAlpha4(t, p) textureGather(t, p, 3)
						#define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)
						#define FxaaTexGreen4(t, p) textureGather(t, p, 1)
						#define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)
				#endif
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_3 == 1)
				#define FxaaInt2 float2
				#define FxaaTex sampler2D
				#define FxaaTexTop(t, p) tex2Dlod(t, float4(p, 0.0, 0.0))
				#define FxaaTexOff(t, p, o, r) tex2Dlod(t, float4(p + (o * r), 0, 0))
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_4 == 1)
				#define FxaaInt2 int2
				struct FxaaTex { SamplerState smpl; Texture2D tex; };
				#define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)
				#define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)
		#endif
		/*--------------------------------------------------------------------------*/
		#if (FXAA_HLSL_5 == 1)
				#define FxaaInt2 int2
				struct FxaaTex { SamplerState smpl; Texture2D tex; };
				#define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)
				#define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)
				#define FxaaTexAlpha4(t, p) t.tex.GatherAlpha(t.smpl, p)
				#define FxaaTexOffAlpha4(t, p, o) t.tex.GatherAlpha(t.smpl, p, o)
				#define FxaaTexGreen4(t, p) t.tex.GatherGreen(t.smpl, p)
				#define FxaaTexOffGreen4(t, p, o) t.tex.GatherGreen(t.smpl, p, o)
		#endif


		/*============================================================================
											 GREEN AS LUMA OPTION SUPPORT FUNCTION
		============================================================================*/
		#if (FXAA_GREEN_AS_LUMA == 0)
				FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.w; }
		#else
				FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.y; }
		#endif




		/*============================================================================

																 FXAA3 QUALITY - PC

		============================================================================*/
		#if (FXAA_PC == 1)
		/*--------------------------------------------------------------------------*/
		FxaaFloat4 FxaaPixelShader(
				//
				// Use noperspective interpolation here (turn off perspective interpolation).
				// {xy} = center of pixel
				FxaaFloat2 pos,
				//
				// Used only for FXAA Console, and not used on the 360 version.
				// Use noperspective interpolation here (turn off perspective interpolation).
				// {xy_} = upper left of pixel
				// {_zw} = lower right of pixel
				FxaaFloat4 fxaaConsolePosPos,
				//
				// Input color texture.
				// {rgb_} = color in linear or perceptual color space
				// if (FXAA_GREEN_AS_LUMA == 0)
				//		 {__a} = luma in perceptual color space (not linear)
				FxaaTex tex,
				//
				// Only used on the optimized 360 version of FXAA Console.
				// For everything but 360, just use the same input here as for "tex".
				// For 360, same texture, just alias with a 2nd sampler.
				// This sampler needs to have an exponent bias of -1.
				FxaaTex fxaaConsole360TexExpBiasNegOne,
				//
				// Only used on the optimized 360 version of FXAA Console.
				// For everything but 360, just use the same input here as for "tex".
				// For 360, same texture, just alias with a 3nd sampler.
				// This sampler needs to have an exponent bias of -2.
				FxaaTex fxaaConsole360TexExpBiasNegTwo,
				//
				// Only used on FXAA Quality.
				// This must be from a constant/uniform.
				// {x_} = 1.0/screenWidthInPixels
				// {_y} = 1.0/screenHeightInPixels
				FxaaFloat2 fxaaQualityRcpFrame,
				//
				// Only used on FXAA Console.
				// This must be from a constant/uniform.
				// This effects sub-pixel AA quality and inversely sharpness.
				//	 Where N ranges between,
				//		 N = 0.50 (default)
				//		 N = 0.33 (sharper)
				// {x__} = -N/screenWidthInPixels
				// {_y_} = -N/screenHeightInPixels
				// {_z_} =	N/screenWidthInPixels
				// {__w} =	N/screenHeightInPixels
				FxaaFloat4 fxaaConsoleRcpFrameOpt,
				//
				// Only used on FXAA Console.
				// Not used on 360, but used on PS3 and PC.
				// This must be from a constant/uniform.
				// {x__} = -2.0/screenWidthInPixels
				// {_y_} = -2.0/screenHeightInPixels
				// {_z_} =	2.0/screenWidthInPixels
				// {__w} =	2.0/screenHeightInPixels
				FxaaFloat4 fxaaConsoleRcpFrameOpt2,
				//
				// Only used on FXAA Console.
				// Only used on 360 in place of fxaaConsoleRcpFrameOpt2.
				// This must be from a constant/uniform.
				// {x__} =	8.0/screenWidthInPixels
				// {_y_} =	8.0/screenHeightInPixels
				// {_z_} = -4.0/screenWidthInPixels
				// {__w} = -4.0/screenHeightInPixels
				FxaaFloat4 fxaaConsole360RcpFrameOpt2,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_SUBPIX define.
				// It is here now to allow easier tuning.
				// Choose the amount of sub-pixel aliasing removal.
				// This can effect sharpness.
				//	 1.00 - upper limit (softer)
				//	 0.75 - default amount of filtering
				//	 0.50 - lower limit (sharper, less sub-pixel aliasing removal)
				//	 0.25 - almost off
				//	 0.00 - completely off
				FxaaFloat fxaaQualitySubpix,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_EDGE_THRESHOLD define.
				// It is here now to allow easier tuning.
				// The minimum amount of local contrast required to apply algorithm.
				//	 0.333 - too little (faster)
				//	 0.250 - low quality
				//	 0.166 - default
				//	 0.125 - high quality
				//	 0.063 - overkill (slower)
				FxaaFloat fxaaQualityEdgeThreshold,
				//
				// Only used on FXAA Quality.
				// This used to be the FXAA_QUALITY_EDGE_THRESHOLD_MIN define.
				// It is here now to allow easier tuning.
				// Trims the algorithm from processing darks.
				//	 0.0833 - upper limit (default, the start of visible unfiltered edges)
				//	 0.0625 - high quality (faster)
				//	 0.0312 - visible limit (slower)
				// Special notes when using FXAA_GREEN_AS_LUMA,
				//	 Likely want to set this to zero.
				//	 As colors that are mostly not-green
				//	 will appear very dark in the green channel!
				//	 Tune by looking at mostly non-green content,
				//	 then start at zero and increase until aliasing is a problem.
				FxaaFloat fxaaQualityEdgeThresholdMin,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_SHARPNESS define.
				// It is here now to allow easier tuning.
				// This does not effect PS3, as this needs to be compiled in.
				//	 Use FXAA_CONSOLE_PS3_EDGE_SHARPNESS for PS3.
				//	 Due to the PS3 being ALU bound,
				//	 there are only three safe values here: 2 and 4 and 8.
				//	 These options use the shaders ability to a free *|/ by 2|4|8.
				// For all other platforms can be a non-power of two.
				//	 8.0 is sharper (default!!!)
				//	 4.0 is softer
				//	 2.0 is really soft (good only for vector graphics inputs)
				FxaaFloat fxaaConsoleEdgeSharpness,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_THRESHOLD define.
				// It is here now to allow easier tuning.
				// This does not effect PS3, as this needs to be compiled in.
				//	 Use FXAA_CONSOLE_PS3_EDGE_THRESHOLD for PS3.
				//	 Due to the PS3 being ALU bound,
				//	 there are only two safe values here: 1/4 and 1/8.
				//	 These options use the shaders ability to a free *|/ by 2|4|8.
				// The console setting has a different mapping than the quality setting.
				// Other platforms can use other values.
				//	 0.125 leaves less aliasing, but is softer (default!!!)
				//	 0.25 leaves more aliasing, and is sharper
				FxaaFloat fxaaConsoleEdgeThreshold,
				//
				// Only used on FXAA Console.
				// This used to be the FXAA_CONSOLE_EDGE_THRESHOLD_MIN define.
				// It is here now to allow easier tuning.
				// Trims the algorithm from processing darks.
				// The console setting has a different mapping than the quality setting.
				// This only applies when FXAA_EARLY_EXIT is 1.
				// This does not apply to PS3,
				// PS3 was simplified to avoid more shader instructions.
				//	 0.06 - faster but more aliasing in darks
				//	 0.05 - default
				//	 0.04 - slower and less aliasing in darks
				// Special notes when using FXAA_GREEN_AS_LUMA,
				//	 Likely want to set this to zero.
				//	 As colors that are mostly not-green
				//	 will appear very dark in the green channel!
				//	 Tune by looking at mostly non-green content,
				//	 then start at zero and increase until aliasing is a problem.
				FxaaFloat fxaaConsoleEdgeThresholdMin,
				//
				// Extra constants for 360 FXAA Console only.
				// Use zeros or anything else for other platforms.
				// These must be in physical constant registers and NOT immediates.
				// Immediates will result in compiler un-optimizing.
				// {xyzw} = float4(1.0, -1.0, 0.25, -0.25)
				FxaaFloat4 fxaaConsole360ConstDir
		) {
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posM;
				posM.x = pos.x;
				posM.y = pos.y;
				#if (FXAA_GATHER4_ALPHA == 1)
						#if (FXAA_DISCARD == 0)
								FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);
								#if (FXAA_GREEN_AS_LUMA == 0)
										#define lumaM rgbyM.w
								#else
										#define lumaM rgbyM.y
								#endif
						#endif
						#if (FXAA_GREEN_AS_LUMA == 0)
								FxaaFloat4 luma4A = FxaaTexAlpha4(tex, posM);
								FxaaFloat4 luma4B = FxaaTexOffAlpha4(tex, posM, FxaaInt2(-1, -1));
						#else
								FxaaFloat4 luma4A = FxaaTexGreen4(tex, posM);
								FxaaFloat4 luma4B = FxaaTexOffGreen4(tex, posM, FxaaInt2(-1, -1));
						#endif
						#if (FXAA_DISCARD == 1)
								#define lumaM luma4A.w
						#endif
						#define lumaE luma4A.z
						#define lumaS luma4A.x
						#define lumaSE luma4A.y
						#define lumaNW luma4B.w
						#define lumaN luma4B.z
						#define lumaW luma4B.x
				#else
						FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);
						#if (FXAA_GREEN_AS_LUMA == 0)
								#define lumaM rgbyM.w
						#else
								#define lumaM rgbyM.y
						#endif
						#if (FXAA_GLSL_100 == 1)
							FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0, 1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 0.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 0.0), fxaaQualityRcpFrame.xy));
						#else
							FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0, 1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 0), fxaaQualityRcpFrame.xy));
						#endif
				#endif
		/*--------------------------------------------------------------------------*/
				FxaaFloat maxSM = max(lumaS, lumaM);
				FxaaFloat minSM = min(lumaS, lumaM);
				FxaaFloat maxESM = max(lumaE, maxSM);
				FxaaFloat minESM = min(lumaE, minSM);
				FxaaFloat maxWN = max(lumaN, lumaW);
				FxaaFloat minWN = min(lumaN, lumaW);
				FxaaFloat rangeMax = max(maxWN, maxESM);
				FxaaFloat rangeMin = min(minWN, minESM);
				FxaaFloat rangeMaxScaled = rangeMax * fxaaQualityEdgeThreshold;
				FxaaFloat range = rangeMax - rangeMin;
				FxaaFloat rangeMaxClamped = max(fxaaQualityEdgeThresholdMin, rangeMaxScaled);
				FxaaBool earlyExit = range < rangeMaxClamped;
		/*--------------------------------------------------------------------------*/
				if(earlyExit)
						#if (FXAA_DISCARD == 1)
								FxaaDiscard;
						#else
								return rgbyM;
						#endif
		/*--------------------------------------------------------------------------*/
				#if (FXAA_GATHER4_ALPHA == 0)
						#if (FXAA_GLSL_100 == 1)
							FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0,-1.0), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 1.0), fxaaQualityRcpFrame.xy));
						#else
							FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1,-1), fxaaQualityRcpFrame.xy));
							FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));
						#endif
				#else
						FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(1, -1), fxaaQualityRcpFrame.xy));
						FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));
				#endif
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNS = lumaN + lumaS;
				FxaaFloat lumaWE = lumaW + lumaE;
				FxaaFloat subpixRcpRange = 1.0/range;
				FxaaFloat subpixNSWE = lumaNS + lumaWE;
				FxaaFloat edgeHorz1 = (-2.0 * lumaM) + lumaNS;
				FxaaFloat edgeVert1 = (-2.0 * lumaM) + lumaWE;
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNESE = lumaNE + lumaSE;
				FxaaFloat lumaNWNE = lumaNW + lumaNE;
				FxaaFloat edgeHorz2 = (-2.0 * lumaE) + lumaNESE;
				FxaaFloat edgeVert2 = (-2.0 * lumaN) + lumaNWNE;
		/*--------------------------------------------------------------------------*/
				FxaaFloat lumaNWSW = lumaNW + lumaSW;
				FxaaFloat lumaSWSE = lumaSW + lumaSE;
				FxaaFloat edgeHorz4 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);
				FxaaFloat edgeVert4 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);
				FxaaFloat edgeHorz3 = (-2.0 * lumaW) + lumaNWSW;
				FxaaFloat edgeVert3 = (-2.0 * lumaS) + lumaSWSE;
				FxaaFloat edgeHorz = abs(edgeHorz3) + edgeHorz4;
				FxaaFloat edgeVert = abs(edgeVert3) + edgeVert4;
		/*--------------------------------------------------------------------------*/
				FxaaFloat subpixNWSWNESE = lumaNWSW + lumaNESE;
				FxaaFloat lengthSign = fxaaQualityRcpFrame.x;
				FxaaBool horzSpan = edgeHorz >= edgeVert;
				FxaaFloat subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;
		/*--------------------------------------------------------------------------*/
				if(!horzSpan) lumaN = lumaW;
				if(!horzSpan) lumaS = lumaE;
				if(horzSpan) lengthSign = fxaaQualityRcpFrame.y;
				FxaaFloat subpixB = (subpixA * (1.0/12.0)) - lumaM;
		/*--------------------------------------------------------------------------*/
				FxaaFloat gradientN = lumaN - lumaM;
				FxaaFloat gradientS = lumaS - lumaM;
				FxaaFloat lumaNN = lumaN + lumaM;
				FxaaFloat lumaSS = lumaS + lumaM;
				FxaaBool pairN = abs(gradientN) >= abs(gradientS);
				FxaaFloat gradient = max(abs(gradientN), abs(gradientS));
				if(pairN) lengthSign = -lengthSign;
				FxaaFloat subpixC = FxaaSat(abs(subpixB) * subpixRcpRange);
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posB;
				posB.x = posM.x;
				posB.y = posM.y;
				FxaaFloat2 offNP;
				offNP.x = (!horzSpan) ? 0.0 : fxaaQualityRcpFrame.x;
				offNP.y = ( horzSpan) ? 0.0 : fxaaQualityRcpFrame.y;
				if(!horzSpan) posB.x += lengthSign * 0.5;
				if( horzSpan) posB.y += lengthSign * 0.5;
		/*--------------------------------------------------------------------------*/
				FxaaFloat2 posN;
				posN.x = posB.x - offNP.x * FXAA_QUALITY_P0;
				posN.y = posB.y - offNP.y * FXAA_QUALITY_P0;
				FxaaFloat2 posP;
				posP.x = posB.x + offNP.x * FXAA_QUALITY_P0;
				posP.y = posB.y + offNP.y * FXAA_QUALITY_P0;
				FxaaFloat subpixD = ((-2.0)*subpixC) + 3.0;
				FxaaFloat lumaEndN = FxaaLuma(FxaaTexTop(tex, posN));
				FxaaFloat subpixE = subpixC * subpixC;
				FxaaFloat lumaEndP = FxaaLuma(FxaaTexTop(tex, posP));
		/*--------------------------------------------------------------------------*/
				if(!pairN) lumaNN = lumaSS;
				FxaaFloat gradientScaled = gradient * 1.0/4.0;
				FxaaFloat lumaMM = lumaM - lumaNN * 0.5;
				FxaaFloat subpixF = subpixD * subpixE;
				FxaaBool lumaMLTZero = lumaMM < 0.0;
		/*--------------------------------------------------------------------------*/
				lumaEndN -= lumaNN * 0.5;
				lumaEndP -= lumaNN * 0.5;
				FxaaBool doneN = abs(lumaEndN) >= gradientScaled;
				FxaaBool doneP = abs(lumaEndP) >= gradientScaled;
				if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P1;
				if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P1;
				FxaaBool doneNP = (!doneN) || (!doneP);
				if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P1;
				if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P1;
		/*--------------------------------------------------------------------------*/
				if(doneNP) {
						if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
						if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
						if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
						if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
						doneN = abs(lumaEndN) >= gradientScaled;
						doneP = abs(lumaEndP) >= gradientScaled;
						if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P2;
						if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P2;
						doneNP = (!doneN) || (!doneP);
						if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P2;
						if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P2;
		/*--------------------------------------------------------------------------*/
						#if (FXAA_QUALITY_PS > 3)
						if(doneNP) {
								if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
								if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
								if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
								if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
								doneN = abs(lumaEndN) >= gradientScaled;
								doneP = abs(lumaEndP) >= gradientScaled;
								if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P3;
								if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P3;
								doneNP = (!doneN) || (!doneP);
								if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P3;
								if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P3;
		/*--------------------------------------------------------------------------*/
								#if (FXAA_QUALITY_PS > 4)
								if(doneNP) {
										if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
										if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
										if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
										if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
										doneN = abs(lumaEndN) >= gradientScaled;
										doneP = abs(lumaEndP) >= gradientScaled;
										if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P4;
										if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P4;
										doneNP = (!doneN) || (!doneP);
										if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P4;
										if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P4;
		/*--------------------------------------------------------------------------*/
										#if (FXAA_QUALITY_PS > 5)
										if(doneNP) {
												if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
												if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
												if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
												if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
												doneN = abs(lumaEndN) >= gradientScaled;
												doneP = abs(lumaEndP) >= gradientScaled;
												if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P5;
												if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P5;
												doneNP = (!doneN) || (!doneP);
												if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P5;
												if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P5;
		/*--------------------------------------------------------------------------*/
												#if (FXAA_QUALITY_PS > 6)
												if(doneNP) {
														if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
														if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
														if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
														if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
														doneN = abs(lumaEndN) >= gradientScaled;
														doneP = abs(lumaEndP) >= gradientScaled;
														if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P6;
														if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P6;
														doneNP = (!doneN) || (!doneP);
														if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P6;
														if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P6;
		/*--------------------------------------------------------------------------*/
														#if (FXAA_QUALITY_PS > 7)
														if(doneNP) {
																if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
																if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
																if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
																if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
																doneN = abs(lumaEndN) >= gradientScaled;
																doneP = abs(lumaEndP) >= gradientScaled;
																if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P7;
																if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P7;
																doneNP = (!doneN) || (!doneP);
																if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P7;
																if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P7;
		/*--------------------------------------------------------------------------*/
				#if (FXAA_QUALITY_PS > 8)
				if(doneNP) {
						if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
						if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
						if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
						if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
						doneN = abs(lumaEndN) >= gradientScaled;
						doneP = abs(lumaEndP) >= gradientScaled;
						if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P8;
						if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P8;
						doneNP = (!doneN) || (!doneP);
						if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P8;
						if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P8;
		/*--------------------------------------------------------------------------*/
						#if (FXAA_QUALITY_PS > 9)
						if(doneNP) {
								if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
								if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
								if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
								if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
								doneN = abs(lumaEndN) >= gradientScaled;
								doneP = abs(lumaEndP) >= gradientScaled;
								if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P9;
								if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P9;
								doneNP = (!doneN) || (!doneP);
								if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P9;
								if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P9;
		/*--------------------------------------------------------------------------*/
								#if (FXAA_QUALITY_PS > 10)
								if(doneNP) {
										if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
										if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
										if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
										if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
										doneN = abs(lumaEndN) >= gradientScaled;
										doneP = abs(lumaEndP) >= gradientScaled;
										if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P10;
										if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P10;
										doneNP = (!doneN) || (!doneP);
										if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P10;
										if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P10;
		/*--------------------------------------------------------------------------*/
										#if (FXAA_QUALITY_PS > 11)
										if(doneNP) {
												if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
												if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
												if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
												if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
												doneN = abs(lumaEndN) >= gradientScaled;
												doneP = abs(lumaEndP) >= gradientScaled;
												if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P11;
												if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P11;
												doneNP = (!doneN) || (!doneP);
												if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P11;
												if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P11;
		/*--------------------------------------------------------------------------*/
												#if (FXAA_QUALITY_PS > 12)
												if(doneNP) {
														if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));
														if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));
														if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;
														if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;
														doneN = abs(lumaEndN) >= gradientScaled;
														doneP = abs(lumaEndP) >= gradientScaled;
														if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P12;
														if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P12;
														doneNP = (!doneN) || (!doneP);
														if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P12;
														if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P12;
		/*--------------------------------------------------------------------------*/
												}
												#endif
		/*--------------------------------------------------------------------------*/
										}
										#endif
		/*--------------------------------------------------------------------------*/
								}
								#endif
		/*--------------------------------------------------------------------------*/
						}
						#endif
		/*--------------------------------------------------------------------------*/
				}
				#endif
		/*--------------------------------------------------------------------------*/
														}
														#endif
		/*--------------------------------------------------------------------------*/
												}
												#endif
		/*--------------------------------------------------------------------------*/
										}
										#endif
		/*--------------------------------------------------------------------------*/
								}
								#endif
		/*--------------------------------------------------------------------------*/
						}
						#endif
		/*--------------------------------------------------------------------------*/
				}
		/*--------------------------------------------------------------------------*/
				FxaaFloat dstN = posM.x - posN.x;
				FxaaFloat dstP = posP.x - posM.x;
				if(!horzSpan) dstN = posM.y - posN.y;
				if(!horzSpan) dstP = posP.y - posM.y;
		/*--------------------------------------------------------------------------*/
				FxaaBool goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;
				FxaaFloat spanLength = (dstP + dstN);
				FxaaBool goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;
				FxaaFloat spanLengthRcp = 1.0/spanLength;
		/*--------------------------------------------------------------------------*/
				FxaaBool directionN = dstN < dstP;
				FxaaFloat dst = min(dstN, dstP);
				FxaaBool goodSpan = directionN ? goodSpanN : goodSpanP;
				FxaaFloat subpixG = subpixF * subpixF;
				FxaaFloat pixelOffset = (dst * (-spanLengthRcp)) + 0.5;
				FxaaFloat subpixH = subpixG * fxaaQualitySubpix;
		/*--------------------------------------------------------------------------*/
				FxaaFloat pixelOffsetGood = goodSpan ? pixelOffset : 0.0;
				FxaaFloat pixelOffsetSubpix = max(pixelOffsetGood, subpixH);
				if(!horzSpan) posM.x += pixelOffsetSubpix * lengthSign;
				if( horzSpan) posM.y += pixelOffsetSubpix * lengthSign;
				#if (FXAA_DISCARD == 1)
						return FxaaTexTop(tex, posM);
				#else
						return FxaaFloat4(FxaaTexTop(tex, posM).xyz, lumaM);
				#endif
		}
		/*==========================================================================*/
		#endif

		void main() {
			gl_FragColor = FxaaPixelShader(
				vUv,
				vec4(0.0),
				tDiffuse,
				tDiffuse,
				tDiffuse,
				resolution,
				vec4(0.0),
				vec4(0.0),
				vec4(0.0),
				0.75,
				0.166,
				0.0833,
				0.0,
				0.0,
				0.0,
				vec4(0.0)
			);

			// TODO avoid querying texture twice for same texel
			gl_FragColor.a = texture2D(tDiffuse, vUv).a;
		}`
	};

	THREE.FXAAShader = FXAAShader;

} )();


// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		render_view: 'Render view', render_view_desc: 'Real materials, light, shadows and post effects in the viewport',
		panel: 'Render', materials: 'Materials…', materials_title: 'Materials',
		light: 'Light', sun_dir: 'Sun direction', sun_height: 'Sun height', sun_strength: 'Sun strength', sun_color: 'Sun color',
		shadows: 'Shadows', shadow_softness: 'Shadow softness', sky: 'Sky light', sky_color: 'Sky color', ground_color: 'Ground bounce',
		floor: 'Shadow floor', floor_reflect: 'Reflective floor', hide_grid: 'Hide grid',
		effects: 'Effects', exposure: 'Exposure', ao: 'Ambient occlusion', ao_strength: 'Occlusion strength', ao_radius: 'Occlusion radius',
		ssr: 'Reflections (SSR)', ssr_strength: 'Reflection strength', bloom: 'Bloom (glow)', bloom_strength: 'Glow strength', bloom_threshold: 'Glow threshold', bloom_radius: 'Glow spread',
		dof: 'Depth of field', dof_focus: 'Focus distance', dof_blur: 'Blur', fxaa: 'Anti-aliasing', vignette: 'Vignette',
		new_material: '+ New material', texture_material: 'texture', custom_material: 'custom', name: 'Name',
		base: 'Base', color: 'Color', texture: 'Texture', roughness: 'Roughness', metalness: 'Metalness', map: 'Map',
		normal: 'Normal map', normal_strength: 'Strength', emission: 'Emission', emission_strength: 'Strength',
		opacity: 'Opacity', glass: 'Glass (transmission)', ior: 'Refraction (IOR)', clearcoat: 'Clearcoat (lacquer)', env: 'Reflections of the sky',
		none: '— none —', load_image: 'Load image…', loaded_image: 'Image',
		assign: 'Assign to selected', unassign: 'Remove from selected', delete: 'Delete', users: 'Used by', elements: 'elements',
		select_material: 'Select a material on the left.',
		msg_assigned: 'Material assigned', msg_select: 'Select cubes or meshes first',
		maps_hint: 'Maps can be any texture of the project (paint your normal or roughness map in Blockbench) or an image file.',
		act_camera_fx: 'Camera effects…', act_light_settings: 'Light settings…', act_make_camera: 'Turn into camera', act_make_light: 'Turn into light',
			act_add_light: 'Add light', act_add_light_desc: 'Add a light (an empty group that shines in the Render view)', act_add_camera: 'Add camera', act_add_camera_desc: 'Add a camera with lens and look effects at the current view',
			skybox: 'Skybox', sky_mode: 'Sky', sky_off: 'Off (plain color)', sky_day: 'Day', sky_sunset: 'Sunset', sky_night: 'Night', sky_overcast: 'Overcast',
		sky_custom: 'Custom colors', sky_image_mode: 'Image (360° panorama)', sky_top: 'Top color', sky_horizon: 'Horizon color', sky_ground: 'Ground color',
		sky_sun: 'Sun / moon disc', sky_clouds: 'Clouds', sky_image: 'Panorama image', sky_rotation: 'Rotation', sky_load: 'Load image…', sky_none: 'no image',
		sky_hint: 'The skybox is the background and also lights and reflects in the materials. Use an equirectangular (2:1) panorama for an image.',
		lights: 'Lights', add_light: '+ Light', light_title: 'Light', light_strength: 'Strength', light_radius: 'Radius (px)', light_shadows: 'Shadows',
		light_hint: 'A light is an empty group. Move it with the Move tool. It shines in the Render view.', light_selected: 'Selected light',
		cameras: 'Cameras', add_camera: '+ Camera', camera_title: 'Camera', camera_selected: 'Selected camera',
		cam_look: 'Look through this camera', cam_looking: 'Looking through it (click to leave)', cam_fov: 'Field of view',
		cam_lens: 'Lens', cam_distortion: 'Corner distortion', cam_distortion_tip: 'Negative = pincushion, positive = barrel (fisheye)', cam_chroma: 'Chromatic aberration',
		cam_look_fx: 'Look', cam_vignette: 'Vignette', cam_grain: 'Film grain', cam_saturation: 'Saturation', cam_contrast: 'Contrast', cam_temperature: 'Warm / cold',
		cam_focus: 'Focus', cam_focus_pick: 'Focus on selected', cam_focus_clear: 'Clear', cam_focus_blur: 'Background blur', cam_focus_none: 'nothing',
		cam_hint: 'A camera is an empty group looking along its -Z axis. Turn it with Rotate, move it with Move; the effects apply in the Render view while you look through it.',
		msg_select_one: 'Select an object first',
	},
	ru: {
		render_view: 'Рендер-вид', render_view_desc: 'Настоящие материалы, свет, тени и пост-эффекты во вьюпорте',
		panel: 'Рендер', materials: 'Материалы…', materials_title: 'Материалы',
		light: 'Свет', sun_dir: 'Солнце: направление', sun_height: 'Солнце: высота', sun_strength: 'Сила солнца', sun_color: 'Цвет солнца',
		shadows: 'Тени', shadow_softness: 'Мягкость теней', sky: 'Свет неба', sky_color: 'Цвет неба', ground_color: 'Отражённый от земли',
		floor: 'Пол для теней', floor_reflect: 'Зеркальный пол', hide_grid: 'Скрыть сетку',
		effects: 'Эффекты', exposure: 'Экспозиция', ao: 'Затенение в углах (AO)', ao_strength: 'Сила затенения', ao_radius: 'Радиус затенения',
		ssr: 'Отражения (SSR)', ssr_strength: 'Сила отражений', bloom: 'Свечение (bloom)', bloom_strength: 'Сила свечения', bloom_threshold: 'Порог свечения', bloom_radius: 'Размытие свечения',
		dof: 'Глубина резкости', dof_focus: 'Дистанция фокуса', dof_blur: 'Размытие', fxaa: 'Сглаживание', vignette: 'Виньетка',
		new_material: '+ Новый материал', texture_material: 'текстура', custom_material: 'свой', name: 'Имя',
		base: 'Основа', color: 'Цвет', texture: 'Текстура', roughness: 'Шероховатость', metalness: 'Металличность', map: 'Карта',
		normal: 'Карта нормалей', normal_strength: 'Сила', emission: 'Свечение', emission_strength: 'Сила',
		opacity: 'Непрозрачность', glass: 'Стекло (пропускание)', ior: 'Преломление (IOR)', clearcoat: 'Лак (clearcoat)', env: 'Отражение неба',
		none: '— нет —', load_image: 'Загрузить картинку…', loaded_image: 'Картинка',
		assign: 'Назначить выделенным', unassign: 'Снять с выделенных', delete: 'Удалить', users: 'Используют', elements: 'элем.',
		select_material: 'Выберите материал слева.',
		msg_assigned: 'Материал назначен', msg_select: 'Сначала выделите кубы или меши',
		maps_hint: 'Картой может быть любая текстура проекта (нарисуйте карту нормалей или шероховатости прямо в Blockbench) или файл-картинка.',
		act_camera_fx: 'Эффекты камеры…', act_light_settings: 'Настройки света…', act_make_camera: 'Сделать камерой', act_make_light: 'Сделать светом',
			act_add_light: 'Добавить свет', act_add_light_desc: 'Добавить свет (пустая группа, светит в Рендер-виде)', act_add_camera: 'Добавить камеру', act_add_camera_desc: 'Добавить камеру с линзой и эффектами в текущем ракурсе',
			skybox: 'Скайбокс', sky_mode: 'Небо', sky_off: 'Выкл (просто цвет)', sky_day: 'День', sky_sunset: 'Закат', sky_night: 'Ночь', sky_overcast: 'Пасмурно',
		sky_custom: 'Свои цвета', sky_image_mode: 'Картинка (панорама 360°)', sky_top: 'Цвет сверху', sky_horizon: 'Цвет горизонта', sky_ground: 'Цвет земли',
		sky_sun: 'Диск солнца / луны', sky_clouds: 'Облака', sky_image: 'Панорама', sky_rotation: 'Поворот', sky_load: 'Загрузить картинку…', sky_none: 'нет картинки',
		sky_hint: 'Скайбокс — это фон, а ещё он освещает и отражается в материалах. Для картинки нужна панорама 2:1 (equirectangular).',
		lights: 'Свет', add_light: '+ Свет', light_title: 'Свет', light_strength: 'Сила', light_radius: 'Радиус (px)', light_shadows: 'Тени',
		light_hint: 'Свет — это пустая группа. Двигайте её инструментом «Перемещение». Светит в Рендер-виде.', light_selected: 'Выбранный свет',
		cameras: 'Камеры', add_camera: '+ Камера', camera_title: 'Камера', camera_selected: 'Выбранная камера',
		cam_look: 'Смотреть через эту камеру', cam_looking: 'Смотрим через неё (нажмите, чтобы выйти)', cam_fov: 'Угол обзора',
		cam_lens: 'Объектив', cam_distortion: 'Искажение углов', cam_distortion_tip: 'Минус = подушка, плюс = бочка (рыбий глаз)', cam_chroma: 'Хроматическая аберрация',
		cam_look_fx: 'Картинка', cam_vignette: 'Виньетка', cam_grain: 'Плёночное зерно', cam_saturation: 'Насыщенность', cam_contrast: 'Контраст', cam_temperature: 'Тепло / холод',
		cam_focus: 'Фокус', cam_focus_pick: 'Фокус на выделенном', cam_focus_clear: 'Сбросить', cam_focus_blur: 'Размытие фона', cam_focus_none: 'ничего',
		cam_hint: 'Камера — пустая группа, смотрящая вдоль своей оси -Z. Поворачивайте «Вращением», двигайте «Перемещением»; эффекты работают в Рендер-виде, пока вы смотрите через неё.',
		msg_select_one: 'Сначала выделите объект',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

// ---------------------------------------------------------------------------
// Settings and materials (saved in the project)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
	sun_azimuth: 40, sun_elevation: 50, sun_strength: 1.6, sun_color: '#fff3e0', shadows: true, shadow_softness: 1,
	sky_strength: 1, sky_color: '#a9c8ff', ground_color: '#5a4a3a', floor: true, floor_reflect: false, hide_grid: true,
	exposure: 1, ao: true, ao_strength: 0.8, ao_radius: 4, ssr: false, ssr_strength: 0.6,
	bloom: true, bloom_strength: 0.8, bloom_threshold: 0.9, bloom_radius: 0.5, dof: false, dof_focus: 60, dof_blur: 0.5, fxaa: true, vignette: 0.25,
	sky_mode: 'off', sky_top: '#2f6fd6', sky_horizon: '#bcd8ff', sky_ground: '#6b5a48', sky_sun: true, sky_clouds: 0.4, sky_image: '', sky_image_name: '', sky_rotation: 0,
	};
const DEFAULT_MATERIAL = {
	name: 'Material', color: '#ffffff', map: null, roughness: 0.8, roughness_map: null, metalness: 0, metalness_map: null,
	normal_map: null, normal_strength: 1, emission: '#ffffff', emission_strength: 0, emission_map: null,
	opacity: 1, transmission: 0, ior: 1.45, clearcoat: 0, env: 0.6,
};
const MAP_KEYS = ['map', 'roughness_map', 'metalness_map', 'normal_map', 'emission_map'];

const settingsOf = () => Object.assign({}, DEFAULT_SETTINGS, (Project && Project.render_settings) || {});

// every texture of the project gets its own material automatically ("tex:uuid"), custom ones are "mat:uuid"
function materialStore() {
	if (!Project.render_materials || typeof Project.render_materials != 'object') Project.render_materials = {};
	const store = Project.render_materials;
	for (const tex of Texture.all) {
		const id = 'tex:' + tex.uuid;
		if (!store[id]) store[id] = Object.assign({}, DEFAULT_MATERIAL, {name: tex.name, map: {kind: 'texture', uuid: tex.uuid}});
	}
	return store;
}
function materialData(id) {
	const store = materialStore();
	return store[id] ? Object.assign({}, DEFAULT_MATERIAL, store[id]) : null;
}

// ---------------------------------------------------------------------------
// three.js materials built from the data
// ---------------------------------------------------------------------------

const texture_cache = new Map();   // key -> THREE.Texture
let material_version = 0;          // bumped on every edit; materials rebuild lazily
const material_cache = new Map();  // id -> {version, material}

function textureFor(ref, srgb) {
	if (!ref) return null;
	if (ref.kind == 'texture') {
		const tex = Texture.all.find(t => t.uuid == ref.uuid);
		if (!tex) return null;
		const source = tex.getMaterial && tex.getMaterial().uniforms && tex.getMaterial().uniforms.map && tex.getMaterial().uniforms.map.value;
		if (!source || !source.image) return null;
		const key = 'tex:' + ref.uuid + ':' + srgb;
		let t = texture_cache.get(key);
		if (!t || t.image !== source.image) {
			t = source.clone();   // shares the image with Blockbench, keeps the pixel art filtering
			t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
			t.needsUpdate = true;
			texture_cache.set(key, t);
		}
		return t;
	}
	if (ref.kind == 'image' && ref.data) {
		const key = 'img:' + ref.data.length + ':' + ref.data.slice(-64) + ':' + srgb;
		let t = texture_cache.get(key);
		if (!t) {
			t = new THREE.TextureLoader().load(ref.data, () => { material_version++; });
			t.magFilter = THREE.NearestFilter;
			t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
			t.flipY = false;   // Blockbench uv already point the right way
			texture_cache.set(key, t);
		}
		return t;
	}
	return null;
}

function buildMaterial(d) {
	const m = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color(d.color),
		map: textureFor(d.map, true),
		roughness: d.roughness, roughnessMap: textureFor(d.roughness_map, false),
		metalness: d.metalness, metalnessMap: textureFor(d.metalness_map, false),
		normalMap: textureFor(d.normal_map, false),
		normalScale: new THREE.Vector2(d.normal_strength, -d.normal_strength),
		emissive: new THREE.Color(d.emission), emissiveIntensity: d.emission_strength, emissiveMap: textureFor(d.emission_map, true),
		opacity: d.opacity, transparent: d.opacity < 1 || d.transmission > 0,
		transmission: d.transmission, ior: d.ior, clearcoat: d.clearcoat, clearcoatRoughness: 0.08,
		envMapIntensity: d.env * ((Project && settingsOf().sky_strength) ?? 1),
		alphaTest: d.opacity >= 1 && d.transmission == 0 ? 0.5 : 0,   // pixel art cut outs (transparent pixels in the texture)
		side: THREE.DoubleSide,
	});
	if (d.emission_strength > 0 && !m.emissiveMap && d.map) m.emissiveMap = m.map;
	m.userData.render_plugin = true;
	return m;
}

function materialFor(id) {
	let c = material_cache.get(id);
	if (c && c.version == material_version) return c.material;
	const d = id == 'default' ? Object.assign({}, DEFAULT_MATERIAL, {name: 'default', color: '#bdbdbd'}) : materialData(id);
	if (!d) return materialFor('default');
	if (c) c.material.dispose();
	c = {version: material_version, material: buildMaterial(d)};
	material_cache.set(id, c);
	return c.material;
}

// which face of a cube a geometry group belongs to (from its normal, in the cube's own space)
function faceOfGroup(geometry, group) {
	const index = geometry.index, normal = geometry.attributes.normal;
	if (!normal) return null;
	const v = index ? index.getX(group.start) : group.start;
	const x = normal.getX(v), y = normal.getY(v), z = normal.getZ(v);
	const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
	if (ax >= ay && ax >= az) return x > 0 ? 'east' : 'west';
	if (ay >= az) return y > 0 ? 'up' : 'down';
	return z > 0 ? 'south' : 'north';
}

function idForTexture(texture) {
	if (!texture) return 'default';
	const uuid = typeof texture == 'string' ? texture : texture.uuid;
	return Texture.all.some(t => t.uuid == uuid) ? 'tex:' + uuid : 'default';
}

// the material (or list of materials, one per geometry group) for an element
function materialsForElement(el) {
	if (el.render_material && materialData(el.render_material)) return materialFor(el.render_material);
	const geometry = el.mesh.geometry;
	if (el instanceof Cube) {
		if (!geometry.groups.length) {
			const first = Object.values(el.faces).find(f => f.texture);
			return materialFor(idForTexture(first && first.texture));
		}
		const list = [];
		for (const g of geometry.groups) {
			const face = faceOfGroup(geometry, g);
			list[g.materialIndex] = materialFor(idForTexture(face && el.faces[face] && el.faces[face].texture));
		}
		for (let i = 0; i < list.length; i++) if (!list[i]) list[i] = materialFor('default');
		return list;
	}
	const first = Object.values(el.faces).find(f => f.texture);
	const m = materialFor(idForTexture(first && first.texture));
	if (!geometry.groups.length) return m;
	const count = Math.max(...geometry.groups.map(g => g.materialIndex)) + 1;
	return new Array(count).fill(m);
}

// ---------------------------------------------------------------------------
// Render view: swaps materials, adds light, renders through the effect chain
// ---------------------------------------------------------------------------

let enabled = false;
const originals = new Map();   // mesh -> Blockbench material
const ours = new WeakSet();    // materials (or arrays) we put on meshes
let rig = null;                // lights, environment, floor

function isOurs(material) {
	if (Array.isArray(material)) return material.length > 0 && material.every(m => m && m.userData && m.userData.render_plugin);
	return !!(material && material.userData && material.userData.render_plugin);
}

function applyMaterials() {
	for (const el of [...Cube.all, ...Mesh.all]) {
		const mesh = el.mesh;
		if (!mesh || !mesh.geometry) continue;
		if (!isOurs(mesh.material)) originals.set(mesh, mesh.material);   // Blockbench may have rebuilt it
		const target = materialsForElement(el);
		const same = Array.isArray(target) && Array.isArray(mesh.material)
			? target.length == mesh.material.length && target.every((m, i) => m === mesh.material[i])
			: target === mesh.material;
		if (!same) mesh.material = target;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}
}

function restoreMaterials() {
	for (const [mesh, material] of originals) {
		if (isOurs(mesh.material)) mesh.material = material;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
	}
	originals.clear();
}

// a soft sky picture (top color, light horizon, ground color) used for sky light and reflections
function skyTexture(sky, ground) {
	const canvas = document.createElement('canvas');
	canvas.width = 256; canvas.height = 128;
	const ctx = canvas.getContext('2d');
	const g = ctx.createLinearGradient(0, 0, 0, 128);
	g.addColorStop(0, sky);
	g.addColorStop(0.48, '#ffffff');
	g.addColorStop(0.52, ground);
	g.addColorStop(1, ground);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 256, 128);
	const t = new THREE.CanvasTexture(canvas);
	t.mapping = THREE.EquirectangularReflectionMapping;
	t.encoding = THREE.sRGBEncoding;
	return t;
}

// ---------------------------------------------------------------------------
// Skybox: a 360° panorama drawn from a few settings (or loaded as an image). It is the background, the sky light and the reflections.
// ---------------------------------------------------------------------------

const SKY_PRESETS = {
	day: {top: '#2f6fd6', horizon: '#bcd8ff', ground: '#6b5a48', stars: false, tint: '#ffffff'},
	sunset: {top: '#27407a', horizon: '#ff9a55', ground: '#3a2a2a', stars: false, tint: '#ffb98a'},
	night: {top: '#03060f', horizon: '#1b2845', ground: '#07080d', stars: true, tint: '#8fa6d8'},
	overcast: {top: '#8e98a6', horizon: '#c9ced6', ground: '#59595c', stars: false, tint: '#e2e5ea'},
};

// smooth repeating noise for the clouds (value noise on a circle, so the panorama has no seam)
function cloudNoise(angle, v, seed) {
	const hash = (x, y, z) => {
		let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483629) ^ seed;
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	};
	let sum = 0, amp = 0.5, total = 0;
	for (let o = 0; o < 5; o++) {
		const f = Math.pow(2, o) * 2.2;
		const x = Math.cos(angle) * f, z = Math.sin(angle) * f, y = v * f * 1.6;
		const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
		const fx = x - xi, fy = y - yi, fz = z - zi;
		const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
		let n = 0;
		for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
			n += hash(xi + dx, yi + dy, zi + dz) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
		}
		sum += n * amp; total += amp; amp *= 0.5;
	}
	return sum / total;
}

function mixHex(a, b, t) {
	return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

// where the sun is in the panorama (same layout three.js uses for equirectangular pictures)
function sunSpot(s, W, H) {
	const az = s.sun_azimuth * Math.PI / 180, el = Math.max(2, s.sun_elevation) * Math.PI / 180;
	const x = Math.cos(el) * Math.sin(az), y = Math.sin(el), z = Math.cos(el) * Math.cos(az);
	return {x: (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * W, y: (1 - (Math.asin(y) / Math.PI + 0.5)) * H};
}

function drawSkyCanvas(s) {
	const W = 1024, H = 512, canvas = document.createElement('canvas');
	canvas.width = W; canvas.height = H;
	const ctx = canvas.getContext('2d');
	const p = SKY_PRESETS[s.sky_mode] || {top: s.sky_top, horizon: s.sky_horizon, ground: s.sky_ground, stars: false, tint: '#ffffff'};
	const g = ctx.createLinearGradient(0, 0, 0, H);
	g.addColorStop(0, p.top);
	g.addColorStop(0.28, mixHex(p.top, p.horizon, 0.45));
	g.addColorStop(0.46, p.horizon);
	g.addColorStop(0.5, p.horizon);
	g.addColorStop(0.53, mixHex(p.horizon, p.ground, 0.8));
	g.addColorStop(0.62, p.ground);
	g.addColorStop(1, mixHex(p.ground, '#000000', 0.35));
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, W, H);

	if (p.stars) {
		let seed = 12345;
		const rnd = () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
		for (let i = 0; i < 900; i++) {
			const y = Math.pow(rnd(), 1.4) * H * 0.47, a = 0.25 + rnd() * 0.75, r = 0.5 + rnd() * 1.1;
			ctx.fillStyle = `rgba(255,255,255,${a})`;
			ctx.beginPath(); ctx.arc(rnd() * W, y, r, 0, Math.PI * 2); ctx.fill();
		}
	}

	// clouds: only above the horizon, thinning out toward it
	const amount = Math.max(0, Math.min(1, s.sky_clouds));
	if (amount > 0.01) {
		const cw = 256, ch = 128, cc = document.createElement('canvas');
		cc.width = cw; cc.height = ch;
		const cctx = cc.getContext('2d'), img = cctx.createImageData(cw, ch);
		const tint = new THREE.Color(p.tint), base = new THREE.Color(1, 1, 1).lerp(tint, 0.55);
		const night = p.stars ? 0.22 : 1;
		for (let y = 0; y < ch * 0.5; y++) {
			const v = y / ch;
			for (let x = 0; x < cw; x++) {
				const n = cloudNoise(x / cw * Math.PI * 2, v, 7);
				const cover = (n - (0.78 - amount * 0.42)) / 0.16;
				const fade = Math.min(1, (0.5 - v) / 0.12) * Math.min(1, v / 0.04 + 0.35);
				const a = Math.max(0, Math.min(1, cover)) * fade * (p.stars ? 0.35 : 0.85);
				const i = (y * cw + x) * 4;
				img.data[i] = base.r * 255 * night; img.data[i + 1] = base.g * 255 * night; img.data[i + 2] = base.b * 255 * night; img.data[i + 3] = a * 255;
			}
		}
		cctx.putImageData(img, 0, 0);
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(cc, 0, 0, W, H);
	}

	if (s.sky_sun) {
		const spot = sunSpot(s, W, H), moon = s.sky_mode == 'night';
		const color = moon ? '#dfe8ff' : s.sun_color;
		const glow = c => { const a = new THREE.Color(c); return `${Math.round(a.r * 255)},${Math.round(a.g * 255)},${Math.round(a.b * 255)}`; };
		for (const dx of [-W, 0, W]) {
			const x = spot.x + dx;
			if (x < -200 || x > W + 200) continue;
			const halo = ctx.createRadialGradient(x, spot.y, 0, x, spot.y, moon ? 70 : 190);
			halo.addColorStop(0, `rgba(${glow(color)},${moon ? 0.45 : 0.75})`);
			halo.addColorStop(1, `rgba(${glow(color)},0)`);
			ctx.fillStyle = halo;
			ctx.fillRect(x - 200, spot.y - 200, 400, 400);
			ctx.fillStyle = moon ? '#f4f7ff' : '#ffffff';
			ctx.beginPath(); ctx.arc(x, spot.y, moon ? 9 : 11, 0, Math.PI * 2); ctx.fill();
		}
	}
	return canvas;
}

// loaded panorama images, by content
const sky_images = new Map();   // key -> {texture, canvas} or 'loading'
let sky_version = 0;
function skyImageCanvas(s) {
	if (!s.sky_image) return null;
	const key = s.sky_image.length + ':' + s.sky_image.slice(-48);
	let entry = sky_images.get(key);
	if (!entry) {
		sky_images.set(key, 'loading');
		const img = new Image();
		img.onload = () => { sky_images.set(key, img); sky_version++; };
		img.onerror = () => { sky_images.set(key, 'error'); };
		img.src = s.sky_image;
		return null;
	}
	if (entry == 'loading' || entry == 'error') return null;
	const W = Math.min(2048, entry.width), H = Math.round(W / 2);
	const canvas = document.createElement('canvas');
	canvas.width = W; canvas.height = H;
	const ctx = canvas.getContext('2d');
	const shift = ((s.sky_rotation % 360) / 360) * W;
	for (const dx of [-W, 0, W]) ctx.drawImage(entry, shift + dx, 0, W, H);
	return canvas;
}

const skyKey = s => s.sky_mode == 'image'
	? ['image', s.sky_image.length, s.sky_image.slice(-32), s.sky_rotation, sky_version].join('|')
	: [s.sky_mode, s.sky_top, s.sky_horizon, s.sky_ground, s.sky_sun, s.sky_clouds, s.sun_azimuth, s.sun_elevation, s.sun_color].join('|');

// the panorama as a texture, or null when the skybox is off (or its image is still loading)
function skyEquirect(s) {
	if (s.sky_mode == 'off') return null;
	const canvas = s.sky_mode == 'image' ? skyImageCanvas(s) : drawSkyCanvas(s);
	if (!canvas) return null;
	const t = new THREE.CanvasTexture(canvas);
	t.mapping = THREE.EquirectangularReflectionMapping;
	t.encoding = THREE.sRGBEncoding;
	return t;
}

function modelBox() {
	const box = new THREE.Box3();
	for (const el of [...Cube.all, ...Mesh.all]) if (el.mesh && el.mesh.visible !== false) box.expandByObject(el.mesh);
	if (box.isEmpty()) box.set(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 16, 8));
	return box;
}

function buildRig(renderer) {
	const s = settingsOf();
	const group = new THREE.Group();
	group.name = 'render_view_rig';
	const sun = new THREE.DirectionalLight(new THREE.Color(s.sun_color), s.sun_strength);
	sun.castShadow = s.shadows;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	sun.shadow.normalBias = 0.02;
	group.add(sun, sun.target);
	const hemi = new THREE.HemisphereLight(new THREE.Color(s.sky_color), new THREE.Color(s.ground_color), 0.1 * s.sky_strength);
	group.add(hemi);
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({opacity: 0.35}));
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	floor.userData.render_plugin_floor = true;
	group.add(floor);
	const pmrem = new THREE.PMREMGenerator(renderer);
	const sky = skyTexture(s.sky_color, s.ground_color);
	const env = pmrem.fromEquirectangular(sky).texture;
	sky.dispose();
	pmrem.dispose();
	return {group, sun, hemi, floor, env, renderer, key: '', bg: null, saved_bg: scene.background, lights: new Map()};
}

function disposeRig() {
	if (!rig) return;
	scene.remove(rig.group);
	scene.background = rig.saved_bg;
	if (rig.env) rig.env.dispose();
	if (rig.bg) rig.bg.dispose();
	rig.lights.forEach(l => l.dispose && l.dispose());
	rig = null;
}

function updateRig() {
	const s = settingsOf();
	const box = modelBox();
	const center = box.getCenter(new THREE.Vector3());
	const radius = Math.max(8, box.getSize(new THREE.Vector3()).length() / 2);
	const az = s.sun_azimuth * Math.PI / 180, el = Math.max(2, s.sun_elevation) * Math.PI / 180;
	const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
	const sun = rig.sun;
	sun.color.set(s.sun_color);
	sun.intensity = s.sun_strength;
	sun.castShadow = s.shadows;
	sun.position.copy(center).addScaledVector(dir, radius * 3);
	sun.target.position.copy(center);
	const cam = sun.shadow.camera;
	cam.left = -radius * 1.4; cam.right = radius * 1.4; cam.top = radius * 1.4; cam.bottom = -radius * 1.4;
	cam.near = radius * 0.5; cam.far = radius * 6;
	cam.updateProjectionMatrix();
	sun.shadow.radius = 1 + s.shadow_softness * 6;
	rig.hemi.color.set(s.sky_color);
	rig.hemi.groundColor.set(s.ground_color);
	rig.hemi.intensity = 0.1 * s.sky_strength;
	const floor = rig.floor;
	floor.visible = s.floor;
	floor.position.set(center.x, Project.model_3d.localToWorld(new THREE.Vector3(0, 0, 0)).y + 0.01, center.z);
	floor.scale.set(radius * 12, radius * 12, 1);
	const want_reflect = s.floor_reflect;
	if (want_reflect != (floor.material.type == 'MeshStandardMaterial')) {
		floor.material.dispose();
		floor.material = want_reflect
			? new THREE.MeshStandardMaterial({color: 0x101010, roughness: 0.08, metalness: 0, envMapIntensity: 0.12})
			: new THREE.ShadowMaterial({opacity: 0.35});
	}
	floor.material.userData.render_plugin = true;
	// a new sky only when its settings change
	const key = s.sky_mode == 'off' ? 'flat|' + s.sky_color + s.ground_color : 'sky|' + skyKey(s);
	if (key != rig.key) {
	rig.key = key;
	const panorama = skyEquirect(s);   // null when off, or while a panorama image is still loading
	if (!panorama && s.sky_mode != 'off') rig.key = '';   // try again next frame
	const pmrem = new THREE.PMREMGenerator(rig.renderer);
	const sky = panorama || skyTexture(s.sky_color, s.ground_color);
	if (rig.env) rig.env.dispose();
	rig.env = pmrem.fromEquirectangular(sky).texture;
	if (rig.bg) { rig.bg.dispose(); rig.bg = null; }
	if (panorama) {
		// a sharp copy for the background (the sky light above is the blurry one)
		rig.bg = new THREE.WebGLCubeRenderTarget(1024).fromEquirectangularTexture(rig.renderer, panorama);
		rig.bg.texture.minFilter = THREE.LinearMipmapLinearFilter;
	}
	sky.dispose();
	pmrem.dispose();
	}
	scene.environment = rig.env;
	scene.background = rig.bg ? rig.bg.texture : rig.saved_bg;
	syncLights();
	if (rig.sky_strength !== s.sky_strength) {
		rig.sky_strength = s.sky_strength;
		material_version++;   // materials pick up the new sky strength
	}
	const grid = scene.getObjectByName('grid_group');
	if (grid) grid.visible = !(s.hide_grid);
}

// ---------------------------------------------------------------------------
// Effect chain (per viewport)
// ---------------------------------------------------------------------------

// The SSAO and SSR passes of r129 render the scene themselves. This wrapper keeps only their own layer
// (occlusion or reflections) and lays it over the picture coming from the previous passes, so they can be combined.
class ChainedEffect extends THREE.Pass {
	constructor(inner, mode) {
		super();
		this.inner = inner;
		this.mode = mode;   // 'multiply' (occlusion) or 'over' (reflections)
		this.strength = 1;
		this.target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType});
		this.copy = new THREE.ShaderMaterial({
			uniforms: {tDiffuse: {value: null}},
			vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
			depthTest: false, depthWrite: false,
		});
		this.blend = new THREE.ShaderMaterial({
			uniforms: {tDiffuse: {value: null}, strength: {value: 1}, multiply: {value: mode == 'multiply' ? 1 : 0}},
			vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform float multiply; varying vec2 vUv;
				void main() {
					vec4 t = texture2D(tDiffuse, vUv);
					if (multiply > 0.5) gl_FragColor = vec4(mix(vec3(1.0), t.rgb, strength), 1.0);
					else gl_FragColor = vec4(t.rgb, t.a * strength);
				}`,
			depthTest: false, depthWrite: false, transparent: true,
		});
		if (mode == 'multiply') {
			this.blend.blending = THREE.CustomBlending;
			this.blend.blendSrc = THREE.DstColorFactor;
			this.blend.blendDst = THREE.ZeroFactor;
			this.blend.blendEquation = THREE.AddEquation;
		} else {
			this.blend.blending = THREE.NormalBlending;
		}
		this.quad = new THREE.FullScreenQuad(null);
	}
	setSize(w, h) {
		this.inner.setSize(w, h);
		this.target.setSize(w, h);
	}
	render(renderer, writeBuffer, readBuffer) {
		this.inner.renderToScreen = false;
		// these passes replace materials (normals, metalness): hide what must stay invisible (Blockbench's hidden helper
		// planes, lines, points, sprites), otherwise it suddenly shows up in the occlusion / reflection layers
		const hidden = [];
		scene.traverseVisible(o => {
			if (o.isLine || o.isPoints || o.isSprite) hidden.push(o);
			else if (o.isMesh) {
				const m = o.material, list = Array.isArray(m) ? m : [m];
				if (!list.length || list.every(x => !x || x.visible === false || x.colorWrite === false)) hidden.push(o);
			}
		});
		hidden.forEach(o => { o.visible = false; });
		const background = scene.background;
		scene.background = null;   // the sky would end up in the occlusion / reflection layers
		try {
		this.inner.render(renderer, this.target, readBuffer);
		} finally {
		scene.background = background;
		hidden.forEach(o => { o.visible = true; });
		}
		const auto = renderer.autoClear;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		renderer.autoClear = false;
		renderer.clear();
		this.copy.uniforms.tDiffuse.value = readBuffer.texture;
		this.quad.material = this.copy;
		this.quad.render(renderer);
		this.blend.uniforms.tDiffuse.value = this.target.texture;
		this.blend.uniforms.strength.value = this.strength;
		this.quad.material = this.blend;
		this.quad.render(renderer);
		renderer.autoClear = auto;
	}
}

// last step: lens (distortion, chromatic aberration), exposure, filmic tone mapping (ACES), color look, vignette, grain
// and conversion to screen colors
const FinalShader = {
	uniforms: {tDiffuse: {value: null}, exposure: {value: 1}, vignette: {value: 0.25}, distortion: {value: 0}, chroma: {value: 0}, grain: {value: 0},
		saturation: {value: 1}, contrast: {value: 1}, temperature: {value: 0}, aspect: {value: 1}, time: {value: 0}},
	vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
	fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure; uniform float vignette; uniform float distortion; uniform float chroma; uniform float grain;
		uniform float saturation; uniform float contrast; uniform float temperature; uniform float aspect; uniform float time; varying vec2 vUv;
		vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
		float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
		void main() {
			// lens distortion: positive = barrel (corners squeezed in, zoomed so the corners still hit the picture), negative = pincushion
			vec2 c = vUv - 0.5;
			c.x *= aspect;
			float corner = 0.25 * (aspect * aspect + 1.0);
			float zoom = distortion > 0.0 ? 1.0 / (1.0 + distortion * corner) : 1.0;
			c *= (1.0 + distortion * dot(c, c)) * zoom;
			vec2 uv = vec2(c.x / aspect, c.y) + 0.5;
			// chromatic aberration: the colors are pushed apart more and more toward the edges
			vec2 off = (uv - 0.5) * chroma * 0.015;
			vec4 g = texture2D(tDiffuse, uv);
			vec3 col = vec3(texture2D(tDiffuse, uv + off).r, g.g, texture2D(tDiffuse, uv - off).b);
			col *= vec3(1.0 + temperature * 0.18, 1.0 + temperature * 0.02, 1.0 - temperature * 0.18);
			col = aces(col * exposure);
			float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
			col = mix(vec3(l), col, saturation);
			col = (col - 0.5) * contrast + 0.5;
			float d = distance(vUv, vec2(0.5));
			col *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
			col += (hash(gl_FragCoord.xy + time * 61.0) - 0.5) * grain * 0.22;
			gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), g.a);
		}`,
};

const pipelines = new Map();   // preview -> pipeline

function selectsForSSR() {
	const list = [];
	for (const el of [...Cube.all, ...Mesh.all]) {
		const m = el.mesh && el.mesh.material;
		const mats = Array.isArray(m) ? m : [m];
		if (mats.some(x => x && x.userData && x.userData.render_plugin && (x.roughness < 0.45 || x.metalness > 0.5))) list.push(el.mesh);
	}
	if (rig && rig.floor.visible && settingsOf().floor_reflect) list.push(rig.floor);
	return list;
}

function buildPipeline(preview) {
	const renderer = preview.renderer;
	const size = renderer.getDrawingBufferSize(new THREE.Vector2());
	const w = Math.max(1, size.x), h = Math.max(1, size.y);
	const target = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
	const composer = new THREE.EffectComposer(renderer, target);
	const camera = preview.camera;
	const s = settingsOf();
	const p = {composer, camera, w, h, key: ''};

	p.render = new THREE.RenderPass(scene, camera);
	composer.addPass(p.render);

	if (s.ao) {
		const ssao = new THREE.SSAOPass(scene, camera, w, h);
		ssao.output = THREE.SSAOPass.OUTPUT.Blur;
		p.ao = new ChainedEffect(ssao, 'multiply');
		composer.addPass(p.ao);
	}
	if (s.ssr) {
		const ssr = new THREE.SSRPass({renderer, scene, camera, width: w, height: h, selects: selectsForSSR(), encoding: THREE.LinearEncoding});
		ssr.output = THREE.SSRPass.OUTPUT.SSR;
		ssr.blur = true;
		p.ssr = new ChainedEffect(ssr, 'over');
		composer.addPass(p.ssr);
	}
	if (s.bloom) {
		p.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), s.bloom_strength, s.bloom_radius, s.bloom_threshold);
		composer.addPass(p.bloom);
	}
	if (s.dof || wantsFocus(activeCameraData())) {
	p.dof = new THREE.BokehPass(scene, camera, {focus: s.dof_focus, aperture: 0.00002, maxblur: 0.01, width: w, height: h});
		const bokeh_render = p.dof.render.bind(p.dof);
		p.dof.render = (...args) => {   // the sky must not end up in the depth picture
			const background = scene.background;
			scene.background = null;
			try { bokeh_render(...args); } finally { scene.background = background; }
		};
		composer.addPass(p.dof);
	}
	p.final = new THREE.ShaderPass(FinalShader);
	composer.addPass(p.final);
	if (s.fxaa) {
		p.fxaa = new THREE.ShaderPass(THREE.FXAAShader);
		composer.addPass(p.fxaa);
	}
	return p;
}

function disposePipeline(p) {
	if (!p) return;
	p.composer.passes.forEach(pass => { if (pass.dispose) pass.dispose(); });
	p.composer.renderTarget1.dispose();
	p.composer.renderTarget2.dispose();
}

function structureKey(preview) {
	const s = settingsOf();
	return [preview.camera.uuid, s.ao, s.ssr, s.bloom, s.dof || wantsFocus(activeCameraData()), s.fxaa].join('|');
}

function pipelineFor(preview) {
	let p = pipelines.get(preview);
	const key = structureKey(preview);
	if (!p || p.key != key) {
		disposePipeline(p);
		p = buildPipeline(preview);
		p.key = key;
		pipelines.set(preview, p);
	}
	const size = preview.renderer.getDrawingBufferSize(new THREE.Vector2());
	if (size.x != p.w || size.y != p.h) {
		p.w = size.x; p.h = size.y;
		p.composer.setSize(size.x / preview.renderer.getPixelRatio(), size.y / preview.renderer.getPixelRatio());
	}
	const s = settingsOf();
	if (p.ao) {
		p.ao.strength = s.ao_strength;
		p.ao.inner.kernelRadius = s.ao_radius;
		p.ao.inner.minDistance = 0.0005;
		p.ao.inner.maxDistance = 0.08;
	}
	if (p.ssr) {
		p.ssr.strength = s.ssr_strength;
		p.ssr.inner.selects = selectsForSSR();
		p.ssr.inner.thickness = 1.5;
	}
	if (p.bloom) { p.bloom.strength = s.bloom_strength; p.bloom.threshold = s.bloom_threshold; p.bloom.radius = s.bloom_radius; }
	const cam = activeCameraData();   // the camera we look through adds its own look
	if (p.dof) {
		const focus = wantsFocus(cam) ? focusDepth(preview.camera, cam.focus) : null;
		const blur = focus !== null ? cam.focus_blur : s.dof_blur;
		p.dof.uniforms.focus.value = focus !== null ? focus : s.dof_focus;
		p.dof.uniforms.aperture.value = 0.00002 * (0.2 + blur * 4);
		p.dof.uniforms.maxblur.value = 0.004 + blur * 0.02;
	}
	const fu = p.final.uniforms;
	fu.exposure.value = s.exposure;
	fu.vignette.value = cam ? cam.vignette : s.vignette;
	fu.distortion.value = cam ? cam.distortion : 0;
	fu.chroma.value = cam ? cam.chroma : 0;
	fu.grain.value = cam ? cam.grain : 0;
	fu.saturation.value = cam ? cam.saturation : 1;
	fu.contrast.value = cam ? cam.contrast : 1;
	fu.temperature.value = cam ? cam.temperature : 0;
	fu.aspect.value = p.w / p.h;
	fu.time.value = (performance.now() / 1000) % 1000;
	if (p.fxaa) p.fxaa.uniforms.resolution.value.set(1 / p.w, 1 / p.h);
	return p;
}

const original_render = Preview.prototype.render;
function renderWithEffects() {
syncActiveCamera(this);
if (!enabled || !Project) return original_render.call(this);
	try {
		this.controls.update();
		applyMaterials();
		if (!rig || rig.renderer !== this.renderer) {
		disposeRig();
		rig = buildRig(this.renderer);
			scene.add(rig.group);
		}
		updateRig();
		const r = this.renderer;
		const saved = {shadow: r.shadowMap.enabled, type: r.shadowMap.type, tone: r.toneMapping, enc: r.outputEncoding};
		r.shadowMap.enabled = true;
		r.shadowMap.type = THREE.PCFSoftShadowMap;
		r.toneMapping = THREE.NoToneMapping;
		r.outputEncoding = THREE.LinearEncoding;
		// Blockbench's camera sees from 1 to 30000 units; the effects keep depth in 16 bits, which is far too coarse
		// for that range. Fit the far plane to the model while rendering, so occlusion and reflections find their surfaces.
		const camera = this.camera;
		const saved_far = camera.far;
		if (camera.isPerspectiveCamera) {
			const box = modelBox();
			const radius = Math.max(16, box.getSize(new THREE.Vector3()).length() / 2);
			camera.far = Math.min(saved_far, camera.position.distanceTo(box.getCenter(new THREE.Vector3())) + radius * 8);
			camera.updateProjectionMatrix();
		}
		const pipe = pipelineFor(this);
		if (pipe.ssr) pipe.ssr.inner.maxDistance = camera.far;
		pipe.composer.render();
		if (camera.far != saved_far) { camera.far = saved_far; camera.updateProjectionMatrix(); }
		r.shadowMap.enabled = saved.shadow; r.shadowMap.type = saved.type; r.toneMapping = saved.tone; r.outputEncoding = saved.enc;
		if (this.css_renderer) this.css_renderer.render(Canvas.scene, this.camera, this == Preview.selected);
	} catch (err) {
		console.error('[Render view]', err);
		setEnabled(false);
		original_render.call(this);
	}
}

function setEnabled(value) {
	enabled = !!value;
	if (toggle && toggle.value != enabled) toggle.set(enabled);
	if (!enabled) {
		restoreMaterials();
		disposeRig();
		scene.environment = null;
		const grid = scene.getObjectByName('grid_group');
		if (grid) grid.visible = true;
		for (const p of pipelines.values()) disposePipeline(p);
		pipelines.clear();
	}
	if (enabled && panel && panel.inside_vue) panel.inside_vue.load();
	updateInterface();
}

function invalidate() {
	material_version++;
	thumbnails_dirty = true;
}

// ---------------------------------------------------------------------------
// Lights and cameras: empty groups that carry extra data. They are drawn as small icons in the editor
// (a light also shows its radius when selected, a camera shows what it sees). Spawn them from the Add menus.
// ---------------------------------------------------------------------------

const DEFAULT_LIGHT = {color: '#ffe0b0', strength: 3, radius: 96, shadows: false};
const DEFAULT_CAMERA = {fov: 50, distortion: 0, chroma: 0, vignette: 0.3, grain: 0, saturation: 1, contrast: 1, temperature: 0, focus: '', focus_blur: 0.6};
const lightOf = node => Object.assign({}, DEFAULT_LIGHT, node.render_light || {});
const cameraOf = node => Object.assign({}, DEFAULT_CAMERA, node.render_camera || {});
// a group named "Camera" is a camera even when it came from Blockbench itself (it has no data of ours yet)
const looksLikeCamera = node => node instanceof Group && /camera|камер/i.test(node.name || '');
// Blockbench may fill an unset object property with {} instead of null: an empty object means "no data"
const hasData = value => !!value && typeof value == 'object' && Object.keys(value).length > 0;
const isCamera = node => node instanceof Group && (hasData(node.render_camera) || looksLikeCamera(node));
const isLight = node => node instanceof Group && hasData(node.render_light) && !looksLikeCamera(node) && !hasData(node.render_camera);
const lightGroups = () => Group.all.filter(isLight);
const cameraGroups = () => Group.all.filter(isCamera);
const findNode = uuid => uuid && [...Cube.all, ...Mesh.all, ...Group.all].find(n => n.uuid == uuid);

function activeCameraGroup() {
	const id = Project && Project.render_active_camera;
	return id ? cameraGroups().find(g => g.uuid == id) || null : null;
}
const activeCameraData = () => { const g = activeCameraGroup(); return g ? cameraOf(g) : null; };

function nodeCenter(node) {
	if (node instanceof Group || !node.getWorldCenter) {
		node.mesh.updateMatrixWorld(true);
		return node.mesh.getWorldPosition(new THREE.Vector3());
	}
	return node.getWorldCenter();
}

// distance from the camera to an object along the view direction (what the depth of field focuses on)
function focusDepth(camera, uuid) {
	const node = findNode(uuid);
	if (!node || !node.mesh) return null;
	const dir = camera.getWorldDirection(new THREE.Vector3());
	return Math.max(1, nodeCenter(node).sub(camera.getWorldPosition(new THREE.Vector3())).dot(dir));
}
const wantsFocus = cam => !!(cam && cam.focus && findNode(cam.focus));

// --- spawning -------------------------------------------------------------

function spawnGroup(kind) {
	if (!Project) return;
	const preview = Preview.selected;
	Undo.initEdit({outliner: true, groups: [], selection: true});
	let origin = new THREE.Vector3(0, 16, 0), rotation = [0, 0, 0];
	if (preview && preview.controls) origin = Project.model_3d.worldToLocal(preview.controls.target.clone());
	if (kind == 'camera' && preview) {
		// a new camera starts exactly where you are looking from
		origin = Project.model_3d.worldToLocal(preview.camera.position.clone());
		const e = new THREE.Euler().setFromQuaternion(preview.camera.quaternion, Format.euler_order || 'ZYX');
		rotation = [e.x, e.y, e.z].map(r => Math.round(r * 180 / Math.PI * 100) / 100);
	}
	const group = new Group({name: tr(kind == 'light' ? 'light_title' : 'camera_title'), origin: origin.toArray().map(n => Math.round(n * 100) / 100), rotation, color: kind == 'light' ? 2 : 4}).init();
	if (kind == 'light') group.render_light = Object.assign({}, DEFAULT_LIGHT);
	else group.render_camera = Object.assign({}, DEFAULT_CAMERA);
	group.addTo();
	group.select();
	Undo.finishEdit(kind == 'light' ? 'Add light' : 'Add camera', {outliner: true, groups: [group], selection: true});
	Project.saved = false;
	syncEditorHelpers();
	if (panel && panel.inside_vue) panel.inside_vue.loadSel();
}

// --- looking through a camera ----------------------------------------------

let look_saved = null;
function setLookThrough(group) {
	const preview = Preview.selected;
	if (group && !look_saved && preview) {
		look_saved = {position: preview.camera.position.clone(), target: preview.controls.target.clone(), fov: preview.camera.fov, ortho: !!preview.isOrtho};
	}
	if (!group && look_saved && preview) {
		if (look_saved.ortho && preview.setProjectionMode) preview.setProjectionMode(true);
		preview.camera.position.copy(look_saved.position);
		preview.controls.target.copy(look_saved.target);
		if (preview.camera.isPerspectiveCamera) { preview.camera.fov = look_saved.fov; preview.camera.updateProjectionMatrix(); }
		look_saved = null;
	}
	Project.render_active_camera = group ? group.uuid : '';
	Project.saved = false;
}

// keeps the viewport glued to the camera we look through (move or turn the camera and the view follows)
function syncActiveCamera(preview) {
	if (!Project || preview !== Preview.selected) return;
	const group = activeCameraGroup();
	if (!group || !group.mesh) return;
	const d = cameraOf(group);
	if (preview.isOrtho && preview.setProjectionMode) preview.setProjectionMode(false);
	group.mesh.updateMatrixWorld(true);
	const pos = group.mesh.getWorldPosition(new THREE.Vector3());
	const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(group.mesh.getWorldQuaternion(new THREE.Quaternion()));
	preview.camera.position.copy(pos);
	preview.controls.target.copy(pos).addScaledVector(forward, 40);
	if (preview.camera.isPerspectiveCamera && preview.camera.fov != d.fov) {
		preview.camera.fov = d.fov;
		preview.camera.updateProjectionMatrix();
	}
}

// --- editor icons ------------------------------------------------------------

const helper_icons = new Map();
function helperIcon(kind) {
	if (helper_icons.has(kind)) return helper_icons.get(kind);
	const size = 128, canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d');
	c.fillStyle = 'rgba(20,20,24,0.82)'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
	c.lineCap = 'round'; c.lineJoin = 'round';
	if (kind == 'light') {
		c.strokeStyle = c.fillStyle = '#ffd24a';
		c.lineWidth = 6;
		c.beginPath(); c.arc(64, 54, 22, 0, Math.PI * 2); c.fill();
		c.fillRect(54, 78, 20, 10); c.fillRect(56, 92, 16, 6);
		for (let i = 0; i < 8; i++) {
			const a = i * Math.PI / 4 + Math.PI / 8, r1 = 31, r2 = 41;
			c.beginPath(); c.moveTo(64 + Math.cos(a) * r1, 54 + Math.sin(a) * r1); c.lineTo(64 + Math.cos(a) * r2, 54 + Math.sin(a) * r2); c.stroke();
		}
		c.strokeStyle = '#ffd24a'; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
	} else {
		c.strokeStyle = c.fillStyle = '#6aa8ff';
		c.lineWidth = 6;
		c.beginPath(); c.roundRect ? c.roundRect(26, 44, 54, 40, 7) : c.rect(26, 44, 54, 40); c.fill();
		c.beginPath(); c.moveTo(84, 58); c.lineTo(104, 46); c.lineTo(104, 82); c.lineTo(84, 70); c.closePath(); c.fill();
		c.fillStyle = '#14141a'; c.beginPath(); c.arc(53, 64, 11, 0, Math.PI * 2); c.fill();
		c.strokeStyle = '#6aa8ff'; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
	}
	const texture = new THREE.CanvasTexture(canvas);
	helper_icons.set(kind, texture);
	return texture;
}

let editor_helpers = new Map();   // group uuid -> {kind, object, sprite, wire, frustum, fov}
function removeEditorHelper(uuid) {
	const h = editor_helpers.get(uuid);
	if (!h) return;
	if (h.object.parent) h.object.parent.remove(h.object);
	h.object.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
	editor_helpers.delete(uuid);
}
function clearEditorHelpers() {
	[...editor_helpers.keys()].forEach(removeEditorHelper);
}

function frustumGeometry(fov) {
	const L = 28, hh = Math.tan(fov * Math.PI / 360) * L, hw = hh * 16 / 9;
	const c = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
	const pts = [];
	for (const [x, y] of c) pts.push(0, 0, 0, x, y, -L);
	for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(a[0], a[1], -L, b[0], b[1], -L); }
	pts.push(-hw * 0.4, hh * 1.08, -L, 0, hh * 1.35, -L, 0, hh * 1.35, -L, hw * 0.4, hh * 1.08, -L);   // "up" marker
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
	return g;
}

function syncEditorHelpers() {
	if (!Project) return clearEditorHelpers();
	const groups = [...lightGroups(), ...cameraGroups()].filter(g => g.mesh);
	for (const uuid of [...editor_helpers.keys()]) {
		const g = groups.find(x => x.uuid == uuid);
		if (!g || editor_helpers.get(uuid).kind != (isLight(g) ? 'light' : 'camera')) removeEditorHelper(uuid);
	}
	const preview = typeof Preview != 'undefined' && Preview.selected, cam = preview && preview.camera;
	const active = activeCameraGroup();
	for (const g of groups) {
		const kind = isLight(g) ? 'light' : 'camera';
		let h = editor_helpers.get(g.uuid);
		if (!h) {
			const object = new THREE.Object3D();
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: helperIcon(kind), sizeAttenuation: false, depthTest: false, transparent: true}));
			sprite.renderOrder = 1000;
			object.add(sprite);
			h = {kind, object, sprite, wire: null, frustum: null, fov: 0};
			if (kind == 'light') {
				h.wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 20, 12)), new THREE.LineBasicMaterial({transparent: true, opacity: 0.35, depthWrite: false}));
				object.add(h.wire);
			} else {
				h.frustum = new THREE.LineSegments(frustumGeometry(50), new THREE.LineBasicMaterial({color: 0x6aa8ff, transparent: true, opacity: 0.9, depthTest: false}));
				h.frustum.renderOrder = 999;
				object.add(h.frustum);
			}
			scene.add(object);
			editor_helpers.set(g.uuid, h);
		}
		g.mesh.updateMatrixWorld(true);
		h.object.position.copy(g.mesh.getWorldPosition(new THREE.Vector3()));
		const ortho = cam && cam.isOrthographicCamera;
		h.sprite.scale.setScalar(ortho ? (cam.top - cam.bottom) / (cam.zoom || 1) * 0.045 : 0.05);
		if (kind == 'light') {
			const d = lightOf(g);
			h.wire.visible = !!g.selected;
			h.wire.scale.setScalar(Math.max(0.01, d.radius));
			h.wire.material.color.set(d.color);
		} else {
			const d = cameraOf(g);
			h.frustum.quaternion.copy(g.mesh.getWorldQuaternion(new THREE.Quaternion()));
			if (h.fov != d.fov) { h.frustum.geometry.dispose(); h.frustum.geometry = frustumGeometry(d.fov); h.fov = d.fov; }
			const here = active && active.uuid == g.uuid;
			h.frustum.visible = hasData(g.render_camera) && !here;   // the frustum is ours only: a camera of Blockbench draws its own
			h.sprite.visible = !here;
			h.frustum.material.color.setHex(g.selected ? 0xffffff : 0x6aa8ff);
		}
	}
}

// --- picking the icons with the mouse ------------------------------------------------
// The icons are not elements, so Blockbench's own picking never sees them: a click on one is caught before Blockbench handles it

// the icon of a light / camera under the mouse (nearest, in pixels), as the group it belongs to
function pickEditorHelper(event, preview) {
	const rect = preview.canvas.getBoundingClientRect(), camera = preview.camera;
	let best = null, bestDistance = Infinity;
	for (const [uuid, h] of editor_helpers) {
		if (!h.sprite.visible || !h.object.parent) continue;
		const v = h.object.position.clone().project(camera);
		if (v.z > 1 || v.z < -1) continue;   // behind the camera
		const x = rect.left + (v.x * 0.5 + 0.5) * rect.width, y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
		const scale = h.sprite.scale.x;
		const half = camera.isOrthographicCamera
			? 0.5 * scale / ((camera.top - camera.bottom) / (camera.zoom || 1)) * rect.height
			: rect.height * 0.25 * scale / Math.tan(camera.fov * Math.PI / 360);
		const d = Math.hypot(event.clientX - x, event.clientY - y);
		if (d <= Math.max(14, half) * 1.15 + 3 && d < bestDistance) { best = uuid; bestDistance = d; }
	}
	return best ? Group.all.find(g => g.uuid == best) || null : null;
}

function onIconPress(event) {
	if (event.button !== 0 || !Project || event.__render_icon) return;
	const previews = (typeof Preview != 'undefined' && Preview.all) || [];
	const preview = previews.find(p => p.canvas && p.canvas === event.target);
	if (!preview) return;
	const group = pickEditorHelper(event, preview);
	if (!group || group.selected) return;   // an already selected one is left alone, so its move / rotate handles keep working
	event.__render_icon = true;
	event.preventDefault();
	event.stopImmediatePropagation();
	group.select(event);
	syncEditorHelpers();
	if (panel && panel.inside_vue) panel.inside_vue.loadSel();
}

// --- real lights in the render view -------------------------------------------

function syncLights() {
	const list = lightGroups().filter(g => g.mesh && g.visibility !== false);
	const seen = new Set();
	let shadows = 0;
	for (const g of list) {
		const d = lightOf(g);
		let light = rig.lights.get(g.uuid);
		if (!light) {
			light = new THREE.PointLight(0xffffff, 1, 100, 2);
			rig.group.add(light);
			rig.lights.set(g.uuid, light);
		}
		g.mesh.updateMatrixWorld(true);
		light.position.copy(g.mesh.getWorldPosition(new THREE.Vector3()));
		light.color.set(d.color);
		light.intensity = d.strength;
		light.distance = Math.max(1, d.radius);
		const cast = !!d.shadows && shadows < 3;
		if (cast) shadows++;
		if (light.castShadow != cast) {
			light.castShadow = cast;
			light.shadow.mapSize.set(1024, 1024);
			light.shadow.bias = -0.001;
			light.shadow.normalBias = 0.05;
			light.shadow.camera.near = 0.5;
		}
		seen.add(g.uuid);
	}
	for (const [uuid, light] of rig.lights) {
		if (seen.has(uuid)) continue;
		rig.group.remove(light);
		if (light.dispose) light.dispose();
		rig.lights.delete(uuid);
	}
}

// --- settings windows (right click a camera / light group) --------------------------

let open_settings = null;
function openSettings(group, kind) {
	if (!group || !Project) return;
	if (open_settings) open_settings.cancel();
	const camera = kind == 'camera';
	if (camera && !hasData(group.render_camera)) group.render_camera = Object.assign({}, DEFAULT_CAMERA);
	if (camera && hasData(group.render_light)) group.render_light = null;   // a camera does not shine
	const d = camera ? cameraOf(group) : lightOf(group);
	const was_looking = activeCameraGroup() === group;
	Undo.initEdit({outliner: true, groups: [group]});
	const options = {'': tr('cam_focus_none')};
	if (camera) [...Cube.all, ...Mesh.all, ...Group.all].filter(n => n !== group).forEach(n => { options[n.uuid] = n.name; });
	const form = camera ? {
		look: {label: tr('cam_look'), type: 'checkbox', value: was_looking},
		fov: {label: tr('cam_fov'), type: 'range', value: d.fov, min: 10, max: 120, step: 1},
		lens: {type: 'info', text: tr('cam_lens')},
		distortion: {label: tr('cam_distortion'), type: 'range', value: d.distortion, min: -1, max: 1, step: 0.02},
		chroma: {label: tr('cam_chroma'), type: 'range', value: d.chroma, min: 0, max: 1, step: 0.02},
		look_fx: {type: 'info', text: tr('cam_look_fx')},
		vignette: {label: tr('cam_vignette'), type: 'range', value: d.vignette, min: 0, max: 1, step: 0.02},
		grain: {label: tr('cam_grain'), type: 'range', value: d.grain, min: 0, max: 1, step: 0.02},
		saturation: {label: tr('cam_saturation'), type: 'range', value: d.saturation, min: 0, max: 2, step: 0.02},
		contrast: {label: tr('cam_contrast'), type: 'range', value: d.contrast, min: 0.5, max: 1.6, step: 0.02},
		temperature: {label: tr('cam_temperature'), type: 'range', value: d.temperature, min: -1, max: 1, step: 0.02},
		focus_info: {type: 'info', text: tr('cam_focus')},
		focus: {label: tr('cam_focus'), type: 'select', options, value: d.focus || ''},
		focus_blur: {label: tr('cam_focus_blur'), type: 'range', value: d.focus_blur, min: 0, max: 1, step: 0.05},
	} : {
		color: {label: tr('color'), type: 'color', value: d.color},
		strength: {label: tr('light_strength'), type: 'range', value: d.strength, min: 0, max: 20, step: 0.1},
		radius: {label: tr('light_radius'), type: 'range', value: d.radius, min: 4, max: 400, step: 1},
		shadows: {label: tr('light_shadows'), type: 'checkbox', value: !!d.shadows},
	};
	const apply = values => {
		const data = Object.assign({}, camera ? cameraOf(group) : lightOf(group));
		for (const key in data) if (values[key] !== undefined) data[key] = values[key];
		if (key_color(values)) data.color = key_color(values);
		if (camera) {
			group.render_camera = data;
			if (!!values.look !== (activeCameraGroup() === group)) setLookThrough(values.look ? group : null);
		} else {
			group.render_light = data;
		}
		Project.saved = false;
		syncEditorHelpers();
	};
	const key_color = values => values.color && (typeof values.color == 'string' ? values.color : values.color.toHexString ? values.color.toHexString() : null);
	const dialog = open_settings = new Dialog({
		id: 'render_object_settings',
		title: (camera ? tr('camera_title') : tr('light_title')) + ' — ' + group.name,
		width: 440,
		darken: false,
		form,
		onFormChange(values) { apply(values); },
		onConfirm(values) {
			open_settings = null;
			apply(values);
			Undo.finishEdit(camera ? 'Edit camera' : 'Edit light', {outliner: true, groups: [group]});
			if (panel && panel.inside_vue) panel.inside_vue.loadSel();
		},
		onCancel() {
			open_settings = null;
			Undo.cancelEdit(false);
			if (camera && was_looking !== (activeCameraGroup() === group)) setLookThrough(was_looking ? group : null);
			syncEditorHelpers();
		},
	});
	dialog.show();
}

// right click menu entries of groups
let menu_actions = [];
function addGroupMenuActions() {
	const selected = () => Project && Group.first_selected;
	const make = (id, name, icon, condition, click) => new Action(id, {name, icon, category: 'edit', condition, click});
	menu_actions = [
		make('render_camera_fx', tr('act_camera_fx'), 'tune', () => { const g = selected(); return !!g && isCamera(g); }, () => openSettings(Group.first_selected, 'camera')),
		make('render_light_settings', tr('act_light_settings'), 'lightbulb', () => { const g = selected(); return !!g && isLight(g); }, () => openSettings(Group.first_selected, 'light')),
	];
	try {
		menu_actions.forEach((a, i) => Group.prototype.menu.addAction(a, i));
	} catch (err) {
		console.warn('[Render view] could not add entries to the group menu', err);
	}
	// the same entries in the Edit menu (they only show for a selected camera / light / plain group)
	try {
		if (typeof MenuBar != 'undefined') menu_actions.forEach(a => MenuBar.addAction(a, 'edit'));
	} catch (err) {
		console.warn('[Render view] could not add entries to the Edit menu', err);
	}
}
function removeGroupMenuActions() {
	menu_actions.forEach(a => {
		try { Group.prototype.menu.removeAction(a); } catch (err) { /* menu already gone */ }
		try { if (typeof MenuBar != 'undefined') MenuBar.removeAction('edit.' + a.id); } catch (err) { /* it was never there */ }
		a.delete();
	});
	menu_actions = [];
}
// --- putting the spawn actions into the "+" (Add) menu ---------------------------

const ADD_ANCHORS = ['add_mesh', 'add_cube', 'add_spline', 'add_billboard', 'add_armature', 'add_locator', 'add_null_object', 'add_bounding_box', 'add_group', 'add_texture_mesh'];
const idOf = item => typeof item == 'string' ? item : item && (item.id || item.uuid);
// index of the last Add entry of a list of menu items (-1 when it is not an Add menu)
const lastAddIndex = list => {
	let last = -1;
	list.forEach((item, i) => { if (ADD_ANCHORS.includes(idOf(item))) last = i; });
	return last;
};
let injected = [];
function injectAddActions(actions) {
	try {
		// the "+" button of the outliner is an action that opens a list; find every list that holds the Add entries
		const items = typeof BarItems != 'undefined' ? Object.values(BarItems) : [];
		for (const item of items) {
			const children = item && item.children;
			if (!children) continue;
			if (Array.isArray(children)) {
				const at = lastAddIndex(children);
				if (at < 0) continue;
				children.splice(at + 1, 0, ...actions);
				injected.push({list: children, actions});
			} else if (typeof children == 'function') {
				let sample = null;
				try { sample = children({}); } catch (err) { continue; }
				if (!Array.isArray(sample) || lastAddIndex(sample) < 0) continue;
				const original = children;
				item.children = (...args) => {
					const list = original.apply(item, args);
					if (!Array.isArray(list)) return list;
					const copy = list.slice();
					const at = lastAddIndex(copy);
					if (at >= 0) copy.splice(at + 1, 0, ...actions);
					return copy;
				};
				injected.push({item, original});
			}
		}
		// menus that list the Add actions directly
		const found = [];
		const walk = structure => {
			if (!Array.isArray(structure)) return;
			if (lastAddIndex(structure) >= 0) found.push(structure);
			structure.forEach(item => { if (item && typeof item == 'object' && Array.isArray(item.children)) walk(item.children); });
		};
		if (typeof MenuBar != 'undefined' && MenuBar.menus) Object.values(MenuBar.menus).forEach(menu => walk(menu && menu.structure));
		for (const structure of new Set(found)) {
			if (injected.some(e => e.list === structure)) continue;
			structure.splice(lastAddIndex(structure) + 1, 0, ...actions);
			injected.push({list: structure, actions});
		}
	} catch (err) {
		console.warn('[Render view] could not add Light / Camera to the Add menu', err);
	}
}
// the "+" button builds its list in a way we cannot see: so whenever any menu is about to open and it holds the Add entries,
// our entries are put in there
let menu_patches = [];
function patchMenusOpening(actions) {
	if (typeof Menu == 'undefined' || !Menu.prototype) return;
	for (const name of ['open', 'show']) {
		const original = Menu.prototype[name];
		if (typeof original != 'function') continue;
		Menu.prototype[name] = function (...args) {
			try {
				const structure = this.structure;
				if (Array.isArray(structure) && !actions.some(a => structure.includes(a))) {
					const at = lastAddIndex(structure);
					if (at >= 0) { structure.splice(at + 1, 0, ...actions); injected.push({list: structure, actions}); }
				}
			} catch (err) { console.warn('[Render view]', err); }
			return original.apply(this, args);
		};
		menu_patches.push({name, original});
	}
}
function unpatchMenusOpening() {
	for (const {name, original} of menu_patches) Menu.prototype[name] = original;
	menu_patches = [];
}

function removeAddActions() {
	unpatchMenusOpening();
	for (const entry of injected) {
		try {
			if (entry.list) entry.actions.forEach(a => { const i = entry.list.indexOf(a); if (i >= 0) entry.list.splice(i, 1); });
			if (entry.item) entry.item.children = entry.original;
		} catch (err) { /* menu already gone */ }
	}
	injected = [];
}

// ---------------------------------------------------------------------------
// Material previews (small balls)
// ---------------------------------------------------------------------------

let thumb = null, thumbnails_dirty = true;
const thumbnails = new Map();   // id -> {version, url}
function thumbRenderer() {
	if (thumb) return thumb;
	const canvas = document.createElement('canvas');
	const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, preserveDrawingBuffer: true});
	renderer.setSize(128, 128, false);
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	const s = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
	camera.position.set(0, 0, 4.2);
	const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32));
	s.add(ball);
	const light = new THREE.DirectionalLight(0xffffff, 2.2);
	light.position.set(-2, 3, 4);
	s.add(light, new THREE.HemisphereLight(0xbfd4ff, 0x4a3a2a, 0.4));
	const pmrem = new THREE.PMREMGenerator(renderer);
	const sky = skyTexture('#a9c8ff', '#5a4a3a');
	s.environment = pmrem.fromEquirectangular(sky).texture;
	sky.dispose(); pmrem.dispose();
	thumb = {renderer, scene: s, camera, ball};
	return thumb;
}
function thumbnailFor(id, size) {
	const cached = thumbnails.get(id + ':' + size);
	if (cached && cached.version == material_version) return cached.url;
	const t = thumbRenderer();
	t.renderer.setSize(size, size, false);
	const d = id == 'default' ? Object.assign({}, DEFAULT_MATERIAL) : materialData(id);
	if (!d) return '';
	const material = buildMaterial(d);
	t.ball.material = material;
	t.renderer.render(t.scene, t.camera);
	const url = t.renderer.domElement.toDataURL();
	material.dispose();
	thumbnails.set(id + ':' + size, {version: material_version, url});
	return url;
}

// ---------------------------------------------------------------------------
// Materials window
// ---------------------------------------------------------------------------

let materials_dialog = null;

function materialList() {
	const store = materialStore();
	const users = {};
	for (const el of [...Cube.all, ...Mesh.all]) if (el.render_material) users[el.render_material] = (users[el.render_material] || 0) + 1;
	return Object.keys(store).filter(id => !id.startsWith('tex:') || Texture.all.some(t => 'tex:' + t.uuid == id)).map(id => ({
		id, name: store[id].name || id, kind: id.startsWith('tex:') ? 'texture' : 'custom', users: users[id] || 0,
	}));
}

function openMaterials() {
	if (!Project) return;
	materialStore();
	if (materials_dialog) { materials_dialog.show(); materials_dialog.content_vue && materials_dialog.content_vue.refresh(); return; }
	materials_dialog = new Dialog({
		id: 'render_materials',
		title: tr('materials_title'),
		width: 860,
		darken: false,
		singleButton: true,
		component: {
			data() {
				return {list: [], selected: '', d: null, version: 0, textures: [], thumbs: {}, big: ''};
			},
			methods: {
				t(key) { return tr(key); },
				refresh() {
					this.list = materialList();
					this.textures = Texture.all.map(t => ({uuid: t.uuid, name: t.name}));
					if (!this.selected || !this.list.some(m => m.id == this.selected)) this.selected = this.list.length ? this.list[0].id : '';
					this.load();
					this.updateThumbs();
				},
				load() { this.d = this.selected ? materialData(this.selected) : null; },
				select(id) { this.selected = id; this.load(); this.updateThumbs(); },
				updateThumbs() {
					const thumbs = {};
					for (const m of this.list) thumbs[m.id] = thumbnailFor(m.id, 72);
					this.thumbs = thumbs;
					this.big = this.selected ? thumbnailFor(this.selected, 200) : '';
				},
				save() {
					if (!this.selected || !this.d) return;
					const num = v => isFinite(parseFloat(v)) ? parseFloat(v) : 0;
					const d = Object.assign({}, this.d);
					['roughness', 'metalness', 'normal_strength', 'emission_strength', 'opacity', 'transmission', 'ior', 'clearcoat', 'env'].forEach(k => { d[k] = num(d[k]); });
					materialStore()[this.selected] = d;
					Project.saved = false;
					invalidate();
					this.list = materialList();
					this.updateThumbs();
				},
				mapValue(key) {
					const ref = this.d && this.d[key];
					if (!ref) return '';
					return ref.kind == 'texture' ? 'texture:' + ref.uuid : 'image';
				},
				setMap(key, value) {
					if (value == 'load') {
						const input = document.createElement('input');
						input.type = 'file';
						input.accept = 'image/*';
						input.onchange = () => {
							const file = input.files[0];
							if (!file) return;
							const reader = new FileReader();
							reader.onload = () => { this.d[key] = {kind: 'image', data: reader.result, name: file.name}; this.save(); this.$forceUpdate(); };
							reader.readAsDataURL(file);
						};
						input.click();
						this.$forceUpdate();
						return;
					}
					if (value == 'image') return;
					this.d[key] = value ? {kind: 'texture', uuid: value.slice('texture:'.length)} : null;
					this.save();
				},
				imageName(key) { const ref = this.d && this.d[key]; return ref && ref.kind == 'image' ? (ref.name || tr('loaded_image')) : ''; },
				addMaterial() {
					const id = 'mat:' + guid();
					materialStore()[id] = Object.assign({}, DEFAULT_MATERIAL, {name: tr('custom_material') + ' ' + (this.list.filter(m => m.kind == 'custom').length + 1)});
					Project.saved = false;
					invalidate();
					this.selected = id;
					this.refresh();
				},
				deleteMaterial() {
					if (!this.selected || !this.selected.startsWith('mat:')) return;
					const id = this.selected;
					delete materialStore()[id];
					for (const el of [...Cube.all, ...Mesh.all]) if (el.render_material == id) el.render_material = '';
					Project.saved = false;
					invalidate();
					this.selected = '';
					this.refresh();
				},
				assign(clear) {
					const elements = Outliner.selected.filter(e => e instanceof Cube || e instanceof Mesh);
					if (!elements.length) { Blockbench.showQuickMessage(tr('msg_select'), 2000); return; }
					Undo.initEdit({elements});
					elements.forEach(el => { el.render_material = clear ? '' : this.selected; });
					Undo.finishEdit(clear ? 'Remove material' : 'Assign material');
					invalidate();
					this.list = materialList();
					if (!clear) Blockbench.showQuickMessage(tr('msg_assigned'), 1200);
				},
			},
			template: `
				<div class="render_materials">
					<div class="render_mat_list">
						<button @click="addMaterial()" style="width: 100%; margin-bottom: 6px;">{{ t('new_material') }}</button>
						<div v-for="m in list" :key="m.id" class="render_mat_item" :class="{selected: m.id == selected}" @click="select(m.id)">
							<img :src="thumbs[m.id]" width="48" height="48">
							<div>
								<div class="render_mat_name">{{ m.name }}</div>
								<div class="render_mat_kind">{{ m.kind == 'texture' ? t('texture_material') : t('custom_material') }}<template v-if="m.users"> · {{ t('users') }} {{ m.users }} {{ t('elements') }}</template></div>
							</div>
						</div>
					</div>
					<div class="render_mat_edit" v-if="d">
						<div class="render_mat_top">
							<img :src="big" width="96" height="96" class="render_mat_ball">
							<div style="flex: 1;">
								<label class="render_row">{{ t('name') }} <input type="text" v-model="d.name" @change="save()"></label>
								<template v-if="selected.startsWith('mat:')">
									<div style="display: flex; gap: 4px; margin-top: 6px;">
										<button @click="assign(false)" style="flex: 1;">{{ t('assign') }}</button>
										<button @click="assign(true)" style="flex: 1;">{{ t('unassign') }}</button>
									</div>
									<button @click="deleteMaterial()" style="margin-top: 4px;">{{ t('delete') }}</button>
								</template>
								<div style="opacity: 0.6; font-size: 0.9em; margin-top: 8px;">{{ t('maps_hint') }}</div>
							</div>
						</div>

						<div class="render_cgrid">
							<span class="cl">{{ t('color') }}</span>
							<div class="cc"><input type="color" v-model="d.color" @change="save()"></div>
							<span class="cl">{{ t('texture') }}</span>
							<select class="cc" :value="mapValue('map')" @change="setMap('map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('map')" value="image">{{ imageName('map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>

							<span class="cl">{{ t('roughness') }}</span>
							<div class="cc cs"><input type="range" min="0" max="1" step="0.01" v-model.number="d.roughness" @change="save()"><span>{{ d.roughness }}</span>
								<select :value="mapValue('roughness_map')" @change="setMap('roughness_map', $event.target.value)" :title="t('map')">
									<option value="">{{ t('map') }}: {{ t('none') }}</option>
									<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
									<option v-if="imageName('roughness_map')" value="image">{{ imageName('roughness_map') }}</option>
									<option value="load">{{ t('load_image') }}</option>
								</select></div>

							<span class="cl">{{ t('metalness') }}</span>
							<div class="cc cs"><input type="range" min="0" max="1" step="0.01" v-model.number="d.metalness" @change="save()"><span>{{ d.metalness }}</span>
								<select :value="mapValue('metalness_map')" @change="setMap('metalness_map', $event.target.value)" :title="t('map')">
									<option value="">{{ t('map') }}: {{ t('none') }}</option>
									<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
									<option v-if="imageName('metalness_map')" value="image">{{ imageName('metalness_map') }}</option>
									<option value="load">{{ t('load_image') }}</option>
								</select></div>

							<span class="cl">{{ t('normal') }}</span>
							<div class="cc cs"><input type="range" min="0" max="3" step="0.05" v-model.number="d.normal_strength" @change="save()"><span>{{ d.normal_strength }}</span>
								<select :value="mapValue('normal_map')" @change="setMap('normal_map', $event.target.value)" :title="t('map')">
									<option value="">{{ t('map') }}: {{ t('none') }}</option>
									<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
									<option v-if="imageName('normal_map')" value="image">{{ imageName('normal_map') }}</option>
									<option value="load">{{ t('load_image') }}</option>
								</select></div>

							<span class="cl">{{ t('emission') }}</span>
							<div class="cc cs"><input type="color" v-model="d.emission" @change="save()" style="flex: none; width: 34px;"><input type="range" min="0" max="10" step="0.1" v-model.number="d.emission_strength" @change="save()"><span>{{ d.emission_strength }}</span>
								<select :value="mapValue('emission_map')" @change="setMap('emission_map', $event.target.value)" :title="t('map')">
									<option value="">{{ t('map') }}: {{ t('none') }}</option>
									<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
									<option v-if="imageName('emission_map')" value="image">{{ imageName('emission_map') }}</option>
									<option value="load">{{ t('load_image') }}</option>
								</select></div>

							<span class="cl">{{ t('opacity') }}</span>
							<div class="cc cs"><input type="range" min="0" max="1" step="0.01" v-model.number="d.opacity" @change="save()"><span>{{ d.opacity }}</span></div>
							<span class="cl">{{ t('glass') }}</span>
							<div class="cc cs"><input type="range" min="0" max="1" step="0.01" v-model.number="d.transmission" @change="save()"><span>{{ d.transmission }}</span></div>
							<span class="cl">{{ t('ior') }}</span>
							<div class="cc cs"><input type="range" min="1" max="2.4" step="0.01" v-model.number="d.ior" @change="save()"><span>{{ d.ior }}</span></div>
							<span class="cl">{{ t('clearcoat') }}</span>
							<div class="cc cs"><input type="range" min="0" max="1" step="0.01" v-model.number="d.clearcoat" @change="save()"><span>{{ d.clearcoat }}</span></div>
							<span class="cl">{{ t('env') }}</span>
							<div class="cc cs"><input type="range" min="0" max="3" step="0.05" v-model.number="d.env" @change="save()"><span>{{ d.env }}</span></div>
						</div>
					</div>
					<div class="render_mat_edit" v-else style="opacity: 0.7;">{{ t('select_material') }}</div>
				</div>`,
		},
		onOpen() { this.content_vue && this.content_vue.refresh(); },
	});
	materials_dialog.show();
	if (materials_dialog.content_vue) materials_dialog.content_vue.refresh();
}

// ---------------------------------------------------------------------------
// Render panel (light and effects)
// ---------------------------------------------------------------------------

let panel = null, toggle = null, materials_action = null, properties = [], style_node = null;
let editing_group = null, add_light_action = null, add_camera_action = null, poll = null;

function panelComponent() {
	return {
		data() { return Object.assign({project: '', light: null, light_uuid: '', cam: null, cam_uuid: '', looking: false, focus_name: ''}, DEFAULT_SETTINGS); },
		mounted() { this.load(); },
		methods: {
			t(key) { return tr(key); },
			load() { Object.assign(this, settingsOf()); this.project = Project ? Project.uuid : ''; this.loadSel(); },
			save() {
				if (!Project) return;
				const s = {};
				for (const k in DEFAULT_SETTINGS) {
					const v = this[k];
					s[k] = typeof DEFAULT_SETTINGS[k] == 'number' ? (isFinite(parseFloat(v)) ? parseFloat(v) : DEFAULT_SETTINGS[k]) : v;
				}
				Project.render_settings = s;
				Project.saved = false;
			},
			materials() { openMaterials(); },
			selectedGroups() { return (Group.multi_selected && Group.multi_selected.length) ? Group.multi_selected.slice() : (Group.first_selected ? [Group.first_selected] : []); },
			loadSel() {
				if (!Project) { this.light = null; this.cam = null; return; }
				const groups = this.selectedGroups();
				const lg = groups.find(isLight), cg = groups.find(isCamera);
				this.light = lg ? lightOf(lg) : null; this.light_uuid = lg ? lg.uuid : '';
				this.cam = cg ? cameraOf(cg) : null; this.cam_uuid = cg ? cg.uuid : '';
				const active = activeCameraGroup();
				this.looking = !!(cg && active && active.uuid == cg.uuid);
				const f = this.cam && this.cam.focus ? findNode(this.cam.focus) : null;
				this.focus_name = f ? f.name : '';
			},
			// a drag on a slider is one undo step: opened on the first change, closed on release
			endEdit(name) {
				if (!editing_group) return;
				Undo.finishEdit(name, {outliner: true, groups: [editing_group]});
				editing_group = null;
			},
			liveEdit(uuid, key, value) {
				const g = Group.all.find(x => x.uuid == uuid);
				if (!g) return;
				if (!editing_group) { Undo.initEdit({outliner: true, groups: [g]}); editing_group = g; }
				g[key] = Object.assign({}, value);
				Project.saved = false;
			},
			liveLight() { this.liveEdit(this.light_uuid, 'render_light', this.light); },
			liveCamera() { this.liveEdit(this.cam_uuid, 'render_camera', this.cam); },
			spawn(kind) { spawnGroup(kind); },
			lookThrough() {
				const g = Group.all.find(x => x.uuid == this.cam_uuid);
				if (!g) return;
				setLookThrough(this.looking ? null : g);
				this.loadSel();
			},
			focusSelected() {
				const node = Outliner.selected[0] || (Group.first_selected && !isCamera(Group.first_selected) && !isLight(Group.first_selected) ? Group.first_selected : null);
				if (!node) { Blockbench.showQuickMessage(tr('msg_select_one'), 2000); return; }
				this.cam.focus = node.uuid;
				this.liveCamera();
				this.endEdit('Edit camera');
				this.loadSel();
			},
			clearFocus() {
				this.cam.focus = '';
				this.liveCamera();
				this.endEdit('Edit camera');
				this.loadSel();
			},
			loadSky() {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'image/*';
				input.onchange = () => {
					const file = input.files[0];
					if (!file) return;
					const reader = new FileReader();
					reader.onload = () => {
						const img = new Image();
						img.onload = () => {
							// keep the project small: at most 2048 px wide
							const w = Math.min(2048, img.width), h = Math.round(img.height * w / img.width);
							const c = document.createElement('canvas');
							c.width = w; c.height = h;
							c.getContext('2d').drawImage(img, 0, 0, w, h);
							this.sky_image = c.toDataURL('image/jpeg', 0.92);
							this.sky_image_name = file.name;
							this.save();
						};
						img.src = reader.result;
					};
					reader.readAsDataURL(file);
				};
				input.click();
			},
		},
		template: `
			<div class="render_panel" style="padding: 4px 8px 10px;">
				<button @click="materials()" style="width: 100%; margin-bottom: 8px;">{{ t('materials') }}</button>
				<details class="render_sec" open><summary>{{ t('light') }}</summary>
				<div class="render_slider"><span class="label">{{ t('sun_dir') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="sun_azimuth" @input="save()"><span>{{ sun_azimuth }}°</span></div>
				<div class="render_slider"><span class="label">{{ t('sun_height') }}</span><input type="range" min="2" max="90" step="1" v-model.number="sun_elevation" @input="save()"><span>{{ sun_elevation }}°</span></div>
				<div class="render_slider"><span class="label">{{ t('sun_strength') }}</span><input type="range" min="0" max="8" step="0.1" v-model.number="sun_strength" @input="save()"><span>{{ sun_strength }}</span></div>
				<label class="render_row">{{ t('sun_color') }} <input type="color" v-model="sun_color" @input="save()"></label>
				<label class="render_row">{{ t('shadows') }} <input type="checkbox" v-model="shadows" @change="save()"></label>
				<div class="render_slider" v-if="shadows"><span class="label">{{ t('shadow_softness') }}</span><input type="range" min="0" max="3" step="0.1" v-model.number="shadow_softness" @input="save()"><span>{{ shadow_softness }}</span></div>
				<div class="render_slider"><span class="label">{{ t('sky') }}</span><input type="range" min="0" max="3" step="0.05" v-model.number="sky_strength" @input="save()"><span>{{ sky_strength }}</span></div>
				<label class="render_row">{{ t('sky_color') }} <input type="color" v-model="sky_color" @change="save()"></label>
				<label class="render_row">{{ t('ground_color') }} <input type="color" v-model="ground_color" @change="save()"></label>
				<label class="render_row">{{ t('floor') }} <input type="checkbox" v-model="floor" @change="save()"></label>
				<label class="render_row" v-if="floor">{{ t('floor_reflect') }} <input type="checkbox" v-model="floor_reflect" @change="save()"></label>
				<label class="render_row">{{ t('hide_grid') }} <input type="checkbox" v-model="hide_grid" @change="save()"></label>

					</details>
<details class="render_sec" ><summary>{{ t('skybox') }}</summary>
					<label class="render_row">{{ t('sky_mode') }}
						<select v-model="sky_mode" @change="save()">
							<option value="off">{{ t('sky_off') }}</option>
							<option value="day">{{ t('sky_day') }}</option>
							<option value="sunset">{{ t('sky_sunset') }}</option>
							<option value="night">{{ t('sky_night') }}</option>
							<option value="overcast">{{ t('sky_overcast') }}</option>
							<option value="custom">{{ t('sky_custom') }}</option>
							<option value="image">{{ t('sky_image_mode') }}</option>
						</select>
					</label>
					<template v-if="sky_mode != 'off'">
						<template v-if="sky_mode == 'custom'">
							<label class="render_row">{{ t('sky_top') }} <input type="color" v-model="sky_top" @change="save()"></label>
							<label class="render_row">{{ t('sky_horizon') }} <input type="color" v-model="sky_horizon" @change="save()"></label>
							<label class="render_row">{{ t('sky_ground') }} <input type="color" v-model="sky_ground" @change="save()"></label>
						</template>
						<template v-if="sky_mode == 'image'">
							<div class="render_row"><span>{{ t('sky_image') }}</span><button @click="loadSky()" style="width: 58%; overflow: hidden; text-overflow: ellipsis;">{{ sky_image_name || t('sky_load') }}</button></div>
							<div class="render_slider"><span class="label">{{ t('sky_rotation') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="sky_rotation" @change="save()"><span>{{ sky_rotation }}°</span></div>
						</template>
						<template v-else>
							<label class="render_row">{{ t('sky_sun') }} <input type="checkbox" v-model="sky_sun" @change="save()"></label>
							<div class="render_slider"><span class="label">{{ t('sky_clouds') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="sky_clouds" @change="save()"><span>{{ sky_clouds }}</span></div>
						</template>
						<div class="render_hint">{{ t('sky_hint') }}</div>
					</template>

				</details>
<details class="render_sec" open><summary>{{ t('effects') }}</summary>
				<div class="render_slider"><span class="label">{{ t('exposure') }}</span><input type="range" min="0.2" max="3" step="0.05" v-model.number="exposure" @input="save()"><span>{{ exposure }}</span></div>
				<label class="render_row">{{ t('ao') }} <input type="checkbox" v-model="ao" @change="save()"></label>
				<template v-if="ao">
					<div class="render_slider"><span class="label">{{ t('ao_strength') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="ao_strength" @input="save()"><span>{{ ao_strength }}</span></div>
					<div class="render_slider"><span class="label">{{ t('ao_radius') }}</span><input type="range" min="0.5" max="16" step="0.5" v-model.number="ao_radius" @input="save()"><span>{{ ao_radius }}</span></div>
				</template>
				<label class="render_row">{{ t('ssr') }} <input type="checkbox" v-model="ssr" @change="save()"></label>
				<div class="render_slider" v-if="ssr"><span class="label">{{ t('ssr_strength') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="ssr_strength" @input="save()"><span>{{ ssr_strength }}</span></div>
				<label class="render_row">{{ t('bloom') }} <input type="checkbox" v-model="bloom" @change="save()"></label>
				<template v-if="bloom">
					<div class="render_slider"><span class="label">{{ t('bloom_strength') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="bloom_strength" @input="save()"><span>{{ bloom_strength }}</span></div>
					<div class="render_slider"><span class="label">{{ t('bloom_threshold') }}</span><input type="range" min="0" max="4" step="0.05" v-model.number="bloom_threshold" @input="save()"><span>{{ bloom_threshold }}</span></div>
					<div class="render_slider"><span class="label">{{ t('bloom_radius') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="bloom_radius" @input="save()"><span>{{ bloom_radius }}</span></div>
				</template>
				<label class="render_row">{{ t('dof') }} <input type="checkbox" v-model="dof" @change="save()"></label>
				<template v-if="dof">
					<div class="render_slider"><span class="label">{{ t('dof_focus') }}</span><input type="range" min="5" max="400" step="1" v-model.number="dof_focus" @input="save()"><span>{{ dof_focus }}</span></div>
					<div class="render_slider"><span class="label">{{ t('dof_blur') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="dof_blur" @input="save()"><span>{{ dof_blur }}</span></div>
				</template>
				<label class="render_row">{{ t('fxaa') }} <input type="checkbox" v-model="fxaa" @change="save()"></label>
				<div class="render_slider"><span class="label">{{ t('vignette') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="vignette" @input="save()"><span>{{ vignette }}</span></div>

					</details>
<details class="render_sec" :open="!!light"><summary>{{ t('lights') }}</summary>
					<button @click="spawn('light')" class="render_btn">{{ t('add_light') }}</button>
					<div v-if="light" class="render_box">
						<div class="render_cap">{{ t('light_selected') }}</div>
						<label class="render_row">{{ t('color') }} <input type="color" v-model="light.color" @input="liveLight()" @change="endEdit('Edit light')"></label>
						<div class="render_slider"><span class="label">{{ t('light_strength') }}</span><input type="range" min="0" max="20" step="0.1" v-model.number="light.strength" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.strength }}</span></div>
						<div class="render_slider"><span class="label">{{ t('light_radius') }}</span><input type="range" min="4" max="400" step="1" v-model.number="light.radius" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.radius }}</span></div>
						<label class="render_row">{{ t('light_shadows') }} <input type="checkbox" v-model="light.shadows" @change="liveLight(); endEdit('Edit light')"></label>
					</div>
					<div v-else class="render_hint">{{ t('light_hint') }}</div>

					</details>
<details class="render_sec" :open="!!cam"><summary>{{ t('cameras') }}</summary>
					<button @click="spawn('camera')" class="render_btn">{{ t('add_camera') }}</button>
					<div v-if="cam" class="render_box">
						<div class="render_cap">{{ t('camera_selected') }}</div>
						<button @click="lookThrough()" class="render_btn" :class="{active: looking}">{{ looking ? t('cam_looking') : t('cam_look') }}</button>
						<div class="render_slider"><span class="label">{{ t('cam_fov') }}</span><input type="range" min="10" max="120" step="1" v-model.number="cam.fov" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.fov }}°</span></div>
						<div class="render_cap">{{ t('cam_lens') }}</div>
						<div class="render_slider" :title="t('cam_distortion_tip')"><span class="label">{{ t('cam_distortion') }}</span><input type="range" min="-1" max="1" step="0.02" v-model.number="cam.distortion" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.distortion }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_chroma') }}</span><input type="range" min="0" max="1" step="0.02" v-model.number="cam.chroma" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.chroma }}</span></div>
						<div class="render_cap">{{ t('cam_look_fx') }}</div>
						<div class="render_slider"><span class="label">{{ t('cam_vignette') }}</span><input type="range" min="0" max="1" step="0.02" v-model.number="cam.vignette" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.vignette }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_grain') }}</span><input type="range" min="0" max="1" step="0.02" v-model.number="cam.grain" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.grain }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_saturation') }}</span><input type="range" min="0" max="2" step="0.02" v-model.number="cam.saturation" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.saturation }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_contrast') }}</span><input type="range" min="0.5" max="1.6" step="0.02" v-model.number="cam.contrast" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.contrast }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_temperature') }}</span><input type="range" min="-1" max="1" step="0.02" v-model.number="cam.temperature" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.temperature }}</span></div>
						<div class="render_cap">{{ t('cam_focus') }}</div>
						<div class="render_row"><span>{{ focus_name || t('cam_focus_none') }}</span><span><button @click="focusSelected()">{{ t('cam_focus_pick') }}</button> <button v-if="cam.focus" @click="clearFocus()">{{ t('cam_focus_clear') }}</button></span></div>
						<div class="render_slider" v-if="cam.focus"><span class="label">{{ t('cam_focus_blur') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="cam.focus_blur" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.focus_blur }}</span></div>
					</div>
					<div v-else class="render_hint">{{ t('cam_hint') }}</div>
			
</details>
</div>`,
	};
}

const STYLE = `
	#panel_render_view .render_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.render_panel h3, .render_materials h3 { font-size: 1em; text-transform: uppercase; opacity: 0.8; margin: 10px 0 4px; }
	.render_sec { border-bottom: 1px solid var(--color-border); padding: 2px 0; }
	.render_sec > summary { cursor: pointer; font-size: 0.95em; text-transform: uppercase; opacity: 0.85; padding: 4px 0; user-select: none; }
	.render_sec[open] > summary { margin-bottom: 2px; }
	.render_row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 1px 0; }
	.render_row input[type=number], .render_row input[type=text], .render_row select { width: 58%; }
	.render_row input[type=color] { width: 58%; height: 22px; border: 1px solid var(--color-border); background: transparent; padding: 0; }
	.render_slider { display: flex; align-items: center; gap: 6px; margin: 1px 0; }
	.render_slider .label { width: 40%; }
	.render_slider input[type=range] { flex: 1; min-width: 0; }
	.render_slider > span:last-child { width: 38px; text-align: right; opacity: 0.8; }
	.render_panel input[type=text], .render_panel select, .render_materials input[type=text], .render_materials select {
		background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px;
	}
	.render_materials { display: flex; gap: 10px; height: 460px; }
	.render_mat_list { width: 190px; overflow-y: auto; padding-right: 4px; }
	.render_mat_item { display: flex; align-items: center; gap: 8px; padding: 4px; border-radius: 4px; cursor: pointer; }
	.render_mat_item:hover { background: var(--color-button); }
	.render_mat_item.selected { background: var(--color-selected); }
	.render_mat_name { font-weight: bold; }
	.render_mat_kind { opacity: 0.6; font-size: 0.85em; }
	.render_mat_edit { flex: 1; overflow-y: auto; padding-right: 6px; }
	.render_hint { opacity: 0.6; font-size: 0.85em; margin: 4px 0 6px; }
	.render_btn { width: 100%; margin: 2px 0 6px; }
	.render_btn.active { background: var(--color-accent); color: var(--color-accent_text, #fff); }
	.render_box { margin: 6px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.render_cap { font-size: 0.82em; opacity: 0.75; margin: 6px 0 2px; text-transform: uppercase; }
	.render_row button { padding: 2px 6px; }
	.render_cgrid { display: grid; grid-template-columns: 78px 1fr; gap: 3px 8px; align-items: center; margin-top: 8px; }
	.render_cgrid .cl { opacity: 0.8; font-size: 0.92em; }
	.render_cgrid .cc { min-width: 0; }
	.render_cgrid select.cc { width: 100%; }
	.render_cgrid .cs { display: flex; align-items: center; gap: 5px; }
	.render_cgrid .cs input[type=range] { flex: 1; min-width: 40px; }
	.render_cgrid .cs > span { width: 32px; text-align: right; opacity: 0.8; }
	.render_cgrid .cs select { width: 42%; flex: none; }
	.render_cgrid input[type=color] { height: 20px; width: 60px; border: 1px solid var(--color-border); background: transparent; padding: 0; }
	.render_mat_top { display: flex; gap: 12px; align-items: flex-start; }
	.render_mat_ball { border-radius: 6px; background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 20px 20px; }
`;

if (typeof __RENDER_EXPORT !== 'undefined') __RENDER_EXPORT({pickEditorHelper, onIconPress, syncEditorHelpers, openSettings, addGroupMenuActions, removeGroupMenuActions, drawSkyCanvas, skyEquirect, FinalShader, SKY_PRESETS, DEFAULT_SETTINGS, frustumGeometry, helperIcon, buildPipeline, pipelineFor, renderWithEffects, setEnabled, settingsOf});

Plugin.register('render', {
	title: 'Render view',
	author: 'Claude',
	description: 'Blender style materials with ball previews, sun, skybox and sky light, point lights, shadows, post effects (AO, reflections, bloom, depth of field) and cameras with lens effects (distortion, chromatic aberration, vignette, grain, focus on an object).',
	about: 'Turn it on with **View > Render view**. The **Render** panel sets the light and the effects, **Materials…** opens the materials window. Every texture of the project has a material; custom materials can be assigned to selected elements. The **Skybox** section draws a sky (day, sunset, night, overcast, custom colors or your own 360° panorama) as background, sky light and reflections. **Add light** and **Add camera** (Add buttons / Edit menu) create an empty group that shines, or a camera you can look through with its own lens and look effects. Uses three.js r129 post processing examples (MIT).',
	icon: 'photo_camera',
	version: '0.2.6',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Rendering'],
	onload() {
		properties.push(new Property(ModelProject, 'object', 'render_settings', {default: null}));
		properties.push(new Property(ModelProject, 'object', 'render_materials', {default: null}));
		properties.push(new Property(Cube, 'string', 'render_material', {default: ''}));
		properties.push(new Property(Mesh, 'string', 'render_material', {default: ''}));
		properties.push(new Property(Group, 'object', 'render_light', {default: null}));
		properties.push(new Property(Group, 'object', 'render_camera', {default: null}));
		properties.push(new Property(ModelProject, 'string', 'render_active_camera', {default: ''}));
		style_node = Blockbench.addCSS(STYLE);
		Preview.prototype.render = renderWithEffects;
		toggle = new Toggle('render_view', {
			name: tr('render_view'),
			description: tr('render_view_desc'),
			icon: 'photo_camera',
			category: 'view',
			value: false,
			onChange(value) { setEnabled(value); },
		});
		materials_action = new Action('render_materials', {
			name: tr('materials_title'),
			icon: 'palette',
			category: 'view',
			condition: () => !!Project,
			click() { openMaterials(); },
		});
		MenuBar.addAction(toggle, 'view');
		MenuBar.addAction(materials_action, 'view');
		add_light_action = new Action('add_render_light', {
			name: tr('act_add_light'), description: tr('act_add_light_desc'), icon: 'lightbulb', category: 'edit',
			condition: () => !!Project, click() { spawnGroup('light'); },
		});
		add_camera_action = new Action('add_render_camera', {
			name: tr('act_add_camera'), description: tr('act_add_camera_desc'), icon: 'videocam', category: 'edit',
			condition: () => !!Project, click() { spawnGroup('camera'); },
		});
		injectAddActions([add_light_action, add_camera_action]);
		patchMenusOpening([add_light_action, add_camera_action]);
		addGroupMenuActions();
		if (!injected.length) {
			// no Add menu found: they are still in the Edit menu and in the action search (Ctrl+K)
			try { MenuBar.addAction(add_light_action, 'edit'); MenuBar.addAction(add_camera_action, 'edit'); } catch (err) { console.warn('[Render view]', err); }
		}
		panel = new Panel('render_view', {
			name: tr('panel'),
			icon: 'photo_camera',
			condition: () => enabled,
			growable: true,
			resizable: true,
			min_height: 200,
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [300, 520], height: 520},
			component: panelComponent(),
		});
		Blockbench.on('select_project', onProject);
		Blockbench.on('update_texture', invalidate);
		Blockbench.on('add_texture', invalidate);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('finished_edit', onSelection);
		Blockbench.on('undo', onSelection);
		Blockbench.on('redo', onSelection);
		poll = setInterval(syncEditorHelpers, 100);
		document.addEventListener('pointerdown', onIconPress, true);
		document.addEventListener('mousedown', onIconPress, true);
		},
	onunload() {
		setEnabled(false);
		Preview.prototype.render = original_render;
		Blockbench.removeListener('select_project', onProject);
		Blockbench.removeListener('update_texture', invalidate);
		Blockbench.removeListener('add_texture', invalidate);
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('finished_edit', onSelection);
		Blockbench.removeListener('undo', onSelection);
		Blockbench.removeListener('redo', onSelection);
		if (poll) clearInterval(poll);
		document.removeEventListener('pointerdown', onIconPress, true);
		document.removeEventListener('mousedown', onIconPress, true);
		clearEditorHelpers();
		removeAddActions();
		removeGroupMenuActions();
		if (open_settings) open_settings.cancel();
		for (const [action, path] of [[add_light_action, 'edit.add_render_light'], [add_camera_action, 'edit.add_render_camera']]) {
			if (!action) continue;
			try { MenuBar.removeAction(path); } catch (err) { /* it was never in the Edit menu */ }
			action.delete();
		}
		add_light_action = null; add_camera_action = null;
		if (materials_dialog) { materials_dialog.close && materials_dialog.close(); materials_dialog = null; }
		if (panel) panel.delete();
		if (toggle) { MenuBar.removeAction('view.render_view'); toggle.delete(); }
		if (materials_action) { MenuBar.removeAction('view.render_materials'); materials_action.delete(); }
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
		if (thumb) { thumb.renderer.dispose(); thumb = null; }
		window.RenderView = undefined;
	},
});

function onSelection() {
	syncEditorHelpers();
	if (panel && panel.inside_vue) panel.inside_vue.loadSel();
}

function onProject() {
	invalidate();
	syncEditorHelpers();
	if (panel && panel.inside_vue) panel.inside_vue.load();
	for (const p of pipelines.values()) disposePipeline(p);
	pipelines.clear();
	restoreMaterials();
}

// for testing from the console
window.RenderView = {setEnabled, openMaterials, settingsOf, materialStore, invalidate, pipelines, get rig() { return rig; }};

})();

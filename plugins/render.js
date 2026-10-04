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

			vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 12.0 ) );
			if ( !( texel.x > -1.0 && texel.y > -1.0 && texel.z > -1.0 ) ) texel = vec4( 0.0 );   // not a number: comparisons with it are false

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
			const kernelSizeArray = [ 6, 10, 14, 18, 22 ];
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
			const bloomFactors = [ 1.0, 0.7, 0.45, 0.25, 0.1 ];
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
					'SIGMA': (kernelRadius / 2.4).toFixed(3)
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


// --- three.js r129 examples/js/geometries/DecalGeometry.js ---
( function () {

	/**
 * You can use this geometry to create a decal mesh, that serves different kinds of purposes.
 * e.g. adding unique details to models, performing dynamic visual environmental changes or covering seams.
 *
 * Constructor parameter:
 *
 * mesh — Any mesh object
 * position — Position of the decal projector
 * orientation — Orientation of the decal projector
 * size — Size of the decal projector
 *
 * reference: http://blog.wolfire.com/2009/06/how-to-project-decals/
 *
 */

	class DecalGeometry extends THREE.BufferGeometry {

		constructor( mesh, position, orientation, size ) {

			super(); // buffers

			const vertices = [];
			const normals = [];
			const uvs = []; // helpers

			const plane = new THREE.Vector3(); // this matrix represents the transformation of the decal projector

			const projectorMatrix = new THREE.Matrix4();
			projectorMatrix.makeRotationFromEuler( orientation );
			projectorMatrix.setPosition( position );
			const projectorMatrixInverse = new THREE.Matrix4();
			projectorMatrixInverse.copy( projectorMatrix ).invert(); // generate buffers

			generate(); // build geometry

			this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
			this.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
			this.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

			function generate() {

				let decalVertices = [];
				const vertex = new THREE.Vector3();
				const normal = new THREE.Vector3(); // handle different geometry types

				if ( mesh.geometry.isGeometry === true ) {

					console.error( 'THREE.DecalGeometry no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.' );
					return;

				}

				const geometry = mesh.geometry;
				const positionAttribute = geometry.attributes.position;
				const normalAttribute = geometry.attributes.normal; // first, create an array of 'DecalVertex' objects
				// three consecutive 'DecalVertex' objects represent a single face
				//
				// this data structure will be later used to perform the clipping

				if ( geometry.index !== null ) {

					// indexed THREE.BufferGeometry
					const index = geometry.index;

					for ( let i = 0; i < index.count; i ++ ) {

						vertex.fromBufferAttribute( positionAttribute, index.getX( i ) );
						normal.fromBufferAttribute( normalAttribute, index.getX( i ) );
						pushDecalVertex( decalVertices, vertex, normal );

					}

				} else {

					// non-indexed THREE.BufferGeometry
					for ( let i = 0; i < positionAttribute.count; i ++ ) {

						vertex.fromBufferAttribute( positionAttribute, i );
						normal.fromBufferAttribute( normalAttribute, i );
						pushDecalVertex( decalVertices, vertex, normal );

					}

				} // second, clip the geometry so that it doesn't extend out from the projector


				decalVertices = clipGeometry( decalVertices, plane.set( 1, 0, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( - 1, 0, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 1, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, - 1, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 0, 1 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 0, - 1 ) ); // third, generate final vertices, normals and uvs

				for ( let i = 0; i < decalVertices.length; i ++ ) {

					const decalVertex = decalVertices[ i ]; // create texture coordinates (we are still in projector space)

					uvs.push( 0.5 + decalVertex.position.x / size.x, 0.5 + decalVertex.position.y / size.y ); // transform the vertex back to world space

					decalVertex.position.applyMatrix4( projectorMatrix ); // now create vertex and normal buffer data

					vertices.push( decalVertex.position.x, decalVertex.position.y, decalVertex.position.z );
					normals.push( decalVertex.normal.x, decalVertex.normal.y, decalVertex.normal.z );

				}

			}

			function pushDecalVertex( decalVertices, vertex, normal ) {

				// transform the vertex to world space, then to projector space
				vertex.applyMatrix4( mesh.matrixWorld );
				vertex.applyMatrix4( projectorMatrixInverse );
				normal.transformDirection( mesh.matrixWorld );
				decalVertices.push( new DecalVertex( vertex.clone(), normal.clone() ) );

			}

			function clipGeometry( inVertices, plane ) {

				const outVertices = [];
				const s = 0.5 * Math.abs( size.dot( plane ) ); // a single iteration clips one face,
				// which consists of three consecutive 'DecalVertex' objects

				for ( let i = 0; i < inVertices.length; i += 3 ) {

					let total = 0;
					let nV1;
					let nV2;
					let nV3;
					let nV4;
					const d1 = inVertices[ i + 0 ].position.dot( plane ) - s;
					const d2 = inVertices[ i + 1 ].position.dot( plane ) - s;
					const d3 = inVertices[ i + 2 ].position.dot( plane ) - s;
					const v1Out = d1 > 0;
					const v2Out = d2 > 0;
					const v3Out = d3 > 0; // calculate, how many vertices of the face lie outside of the clipping plane

					total = ( v1Out ? 1 : 0 ) + ( v2Out ? 1 : 0 ) + ( v3Out ? 1 : 0 );

					switch ( total ) {

						case 0:
						{

							// the entire face lies inside of the plane, no clipping needed
							outVertices.push( inVertices[ i ] );
							outVertices.push( inVertices[ i + 1 ] );
							outVertices.push( inVertices[ i + 2 ] );
							break;

						}

						case 1:
						{

							// one vertex lies outside of the plane, perform clipping
							if ( v1Out ) {

								nV1 = inVertices[ i + 1 ];
								nV2 = inVertices[ i + 2 ];
								nV3 = clip( inVertices[ i ], nV1, plane, s );
								nV4 = clip( inVertices[ i ], nV2, plane, s );

							}

							if ( v2Out ) {

								nV1 = inVertices[ i ];
								nV2 = inVertices[ i + 2 ];
								nV3 = clip( inVertices[ i + 1 ], nV1, plane, s );
								nV4 = clip( inVertices[ i + 1 ], nV2, plane, s );
								outVertices.push( nV3 );
								outVertices.push( nV2.clone() );
								outVertices.push( nV1.clone() );
								outVertices.push( nV2.clone() );
								outVertices.push( nV3.clone() );
								outVertices.push( nV4 );
								break;

							}

							if ( v3Out ) {

								nV1 = inVertices[ i ];
								nV2 = inVertices[ i + 1 ];
								nV3 = clip( inVertices[ i + 2 ], nV1, plane, s );
								nV4 = clip( inVertices[ i + 2 ], nV2, plane, s );

							}

							outVertices.push( nV1.clone() );
							outVertices.push( nV2.clone() );
							outVertices.push( nV3 );
							outVertices.push( nV4 );
							outVertices.push( nV3.clone() );
							outVertices.push( nV2.clone() );
							break;

						}

						case 2:
						{

							// two vertices lies outside of the plane, perform clipping
							if ( ! v1Out ) {

								nV1 = inVertices[ i ].clone();
								nV2 = clip( nV1, inVertices[ i + 1 ], plane, s );
								nV3 = clip( nV1, inVertices[ i + 2 ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							if ( ! v2Out ) {

								nV1 = inVertices[ i + 1 ].clone();
								nV2 = clip( nV1, inVertices[ i + 2 ], plane, s );
								nV3 = clip( nV1, inVertices[ i ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							if ( ! v3Out ) {

								nV1 = inVertices[ i + 2 ].clone();
								nV2 = clip( nV1, inVertices[ i ], plane, s );
								nV3 = clip( nV1, inVertices[ i + 1 ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							break;

						}

						case 3:
						{

							// the entire face lies outside of the plane, so let's discard the corresponding vertices
							break;

						}

					}

				}

				return outVertices;

			}

			function clip( v0, v1, p, s ) {

				const d0 = v0.position.dot( p ) - s;
				const d1 = v1.position.dot( p ) - s;
				const s0 = d0 / ( d0 - d1 );
				const v = new DecalVertex( new THREE.Vector3( v0.position.x + s0 * ( v1.position.x - v0.position.x ), v0.position.y + s0 * ( v1.position.y - v0.position.y ), v0.position.z + s0 * ( v1.position.z - v0.position.z ) ), new THREE.Vector3( v0.normal.x + s0 * ( v1.normal.x - v0.normal.x ), v0.normal.y + s0 * ( v1.normal.y - v0.normal.y ), v0.normal.z + s0 * ( v1.normal.z - v0.normal.z ) ) ); // need to clip more values (texture coordinates)? do it this way:
				// intersectpoint.value = a.value + s * ( b.value - a.value );

				return v;

			}

		}

	} // helper


	class DecalVertex {

		constructor( position, normal ) {

			this.position = position;
			this.normal = normal;

		}

		clone() {

			return new this.constructor( this.position.clone(), this.normal.clone() );

		}

	}

	THREE.DecalGeometry = DecalGeometry;
	THREE.DecalVertex = DecalVertex;

} )();

// --- three.js r129 examples/js/lights/RectAreaLightUniformsLib.js ---
( function () {

	/**
 * Uniforms library for RectAreaLight shared webgl shaders
 *
 * NOTE: This is a temporary location for the BRDF approximation texture data
 *       based off of Eric Heitz's work (see citation below).  BRDF data for
 *       RectAreaLight is currently approximated using a precomputed texture
 *       of roughly 80kb in size.  The hope is to find a better way to include
 *       the large texture data before including the full RectAreaLight implementation
 *       in the main build files.
 *
 * TODO: figure out a way to compress the LTC BRDF data
 */
	// Real-Time Polygonal-Light Shading with Linearly Transformed Cosines
	// by Eric Heitz, Jonathan Dupuy, Stephen Hill and David Neubelt
	// code: https://github.com/selfshadow/ltc_code/

	class RectAreaLightUniformsLib {

		static init() {

			// source: https://github.com/selfshadow/ltc_code/tree/master/fit/results/ltc.js
			const LTC_MAT_1 = [ 1, 0, 0, 2e-05, 1, 0, 0, 0.000503905, 1, 0, 0, 0.00201562, 1, 0, 0, 0.00453516, 1, 0, 0, 0.00806253, 1, 0, 0, 0.0125978, 1, 0, 0, 0.018141, 1, 0, 0, 0.0246924, 1, 0, 0, 0.0322525, 1, 0, 0, 0.0408213, 1, 0, 0, 0.0503999, 1, 0, 0, 0.0609894, 1, 0, 0, 0.0725906, 1, 0, 0, 0.0852058, 1, 0, 0, 0.0988363, 1, 0, 0, 0.113484, 1, 0, 0, 0.129153, 1, 0, 0, 0.145839, 1, 0, 0, 0.163548, 1, 0, 0, 0.182266, 1, 0, 0, 0.201942, 1, 0, 0, 0.222314, 1, 0, 0, 0.241906, 1, 0, 0, 0.262314, 1, 0, 0, 0.285754, 1, 0, 0, 0.310159, 1, 0, 0, 0.335426, 1, 0, 0, 0.361341, 1, 0, 0, 0.387445, 1, 0, 0, 0.412784, 1, 0, 0, 0.438197, 1, 0, 0, 0.466966, 1, 0, 0, 0.49559, 1, 0, 0, 0.523448, 1, 0, 0, 0.549938, 1, 0, 0, 0.57979, 1, 0, 0, 0.608746, 1, 0, 0, 0.636185, 1, 0, 0, 0.664748, 1, 0, 0, 0.69313, 1, 0, 0, 0.71966, 1, 0, 0, 0.747662, 1, 0, 0, 0.774023, 1, 0, 0, 0.799775, 1, 0, 0, 0.825274, 1, 0, 0, 0.849156, 1, 0, 0, 0.873248, 1, 0, 0, 0.89532, 1, 0, 0, 0.917565, 1, 0, 0, 0.937863, 1, 0, 0, 0.958139, 1, 0, 0, 0.976563, 1, 0, 0, 0.994658, 1, 0, 0, 1.0112, 1, 0, 0, 1.02712, 1, 0, 0, 1.04189, 1, 0, 0, 1.05568, 1, 0, 0, 1.06877, 1, 0, 0, 1.08058, 1, 0, 0, 1.09194, 1, 0, 0, 1.10191, 1, 0, 0, 1.11161, 1, 0, 0, 1.1199, 1, 0, 0, 1.12813, 0.999547, - 4.48815e-07, 0.0224417, 1.99902e-05, 0.999495, - 1.13079e-05, 0.0224406, 0.000503651, 0.999496, - 4.52317e-05, 0.0224406, 0.00201461, 0.999496, - 0.000101772, 0.0224406, 0.00453287, 0.999495, - 0.000180928, 0.0224406, 0.00805845, 0.999497, - 0.000282702, 0.0224406, 0.0125914, 0.999496, - 0.000407096, 0.0224406, 0.0181319, 0.999498, - 0.000554114, 0.0224406, 0.02468, 0.999499, - 0.000723768, 0.0224406, 0.0322363, 0.999495, - 0.000916058, 0.0224405, 0.0408009, 0.999499, - 0.00113101, 0.0224408, 0.050375, 0.999494, - 0.00136863, 0.0224405, 0.0609586, 0.999489, - 0.00162896, 0.0224401, 0.0725537, 0.999489, - 0.00191201, 0.0224414, 0.0851619, 0.999498, - 0.00221787, 0.0224413, 0.0987867, 0.999492, - 0.00254642, 0.0224409, 0.113426, 0.999507, - 0.00289779, 0.0224417, 0.129088, 0.999494, - 0.0032716, 0.0224386, 0.145767, 0.999546, - 0.0036673, 0.0224424, 0.163472, 0.999543, - 0.00408166, 0.0224387, 0.182182, 0.999499, - 0.00450056, 0.0224338, 0.201843, 0.999503, - 0.00483661, 0.0224203, 0.222198, 0.999546, - 0.00452928, 0.022315, 0.241714, 0.999508, - 0.00587403, 0.0224329, 0.262184, 0.999509, - 0.00638806, 0.0224271, 0.285609, 0.999501, - 0.00691028, 0.0224166, 0.309998, 0.999539, - 0.00741979, 0.0223989, 0.335262, 0.999454, - 0.00786282, 0.0223675, 0.361154, 0.999529, - 0.00811928, 0.0222828, 0.387224, 0.999503, - 0.00799941, 0.0221063, 0.41252, 0.999561, - 0.00952753, 0.0223057, 0.438006, 0.999557, - 0.0099134, 0.0222065, 0.466735, 0.999541, - 0.0100935, 0.0220402, 0.495332, 0.999562, - 0.00996821, 0.0218067, 0.523197, 0.999556, - 0.0105031, 0.0217096, 0.550223, 0.999561, - 0.0114191, 0.0217215, 0.579498, 0.999588, - 0.0111818, 0.0213357, 0.608416, 0.999633, - 0.0107725, 0.0208689, 0.635965, 0.999527, - 0.0121671, 0.0210149, 0.664476, 0.999508, - 0.0116005, 0.020431, 0.692786, 0.999568, - 0.0115604, 0.0199791, 0.719709, 0.999671, - 0.0121117, 0.0197415, 0.74737, 0.999688, - 0.0110769, 0.0188846, 0.773692, 0.99962, - 0.0122368, 0.0188452, 0.799534, 0.999823, - 0.0110325, 0.0178001, 0.825046, 0.999599, - 0.0114923, 0.0174221, 0.849075, 0.999619, - 0.0105923, 0.0164345, 0.872999, 0.999613, - 0.0105988, 0.0158227, 0.895371, 0.99964, - 0.00979861, 0.0148131, 0.917364, 0.99977, - 0.00967238, 0.0140721, 0.938002, 0.999726, - 0.00869175, 0.0129543, 0.957917, 0.99973, - 0.00866872, 0.0122329, 0.976557, 0.999773, - 0.00731956, 0.0108958, 0.994459, 0.999811, - 0.00756027, 0.0102715, 1.01118, 0.999862, - 0.00583732, 0.00878781, 1.02701, 0.999835, - 0.00631438, 0.00827529, 1.04186, 0.999871, - 0.00450785, 0.00674583, 1.05569, 0.999867, - 0.00486079, 0.00621041, 1.06861, 0.999939, - 0.00322072, 0.00478301, 1.08064, 0.999918, - 0.00318199, 0.00406395, 1.09181, 1.00003, - 0.00193348, 0.00280682, 1.10207, 0.999928, - 0.00153729, 0.00198741, 1.11152, 0.999933, - 0.000623666, 0.000917714, 1.12009, 1, - 1.02387e-06, 9.07581e-07, 1.12813, 0.997866, - 8.96716e-07, 0.0448334, 1.99584e-05, 0.997987, - 2.25945e-05, 0.0448389, 0.000502891, 0.997987, - 9.03781e-05, 0.0448388, 0.00201156, 0.997985, - 0.000203351, 0.0448388, 0.00452602, 0.997986, - 0.000361514, 0.0448388, 0.00804629, 0.997987, - 0.00056487, 0.0448389, 0.0125724, 0.997988, - 0.000813423, 0.0448389, 0.0181045, 0.997984, - 0.00110718, 0.0448387, 0.0246427, 0.997985, - 0.00144616, 0.0448388, 0.0321875, 0.997987, - 0.00183038, 0.044839, 0.0407392, 0.997983, - 0.00225987, 0.0448387, 0.0502986, 0.997991, - 0.00273467, 0.0448389, 0.0608667, 0.997984, - 0.00325481, 0.0448384, 0.0724444, 0.998002, - 0.00382043, 0.044839, 0.0850348, 0.997997, - 0.00443145, 0.0448396, 0.0986372, 0.998007, - 0.00508796, 0.0448397, 0.113255, 0.998008, - 0.00578985, 0.04484, 0.128891, 0.998003, - 0.00653683, 0.0448384, 0.145548, 0.997983, - 0.00732713, 0.0448358, 0.163221, 0.997985, - 0.00815454, 0.0448358, 0.181899, 0.998005, - 0.00898985, 0.0448286, 0.201533, 0.998026, - 0.00964404, 0.0447934, 0.221821, 0.998055, - 0.00922677, 0.044611, 0.241282, 0.99804, - 0.0117361, 0.0448245, 0.261791, 0.998048, - 0.0127628, 0.0448159, 0.285181, 0.998088, - 0.0138055, 0.0447996, 0.30954, 0.998058, - 0.0148206, 0.0447669, 0.334751, 0.998099, - 0.0156998, 0.044697, 0.36061, 0.998116, - 0.0161976, 0.0445122, 0.386603, 0.998195, - 0.015945, 0.0441711, 0.411844, 0.998168, - 0.0183947, 0.0444255, 0.43773, 0.998184, - 0.0197913, 0.0443809, 0.466009, 0.998251, - 0.0201426, 0.0440689, 0.494574, 0.998305, - 0.0198847, 0.0435632, 0.522405, 0.998273, - 0.0210577, 0.043414, 0.549967, 0.998254, - 0.0227901, 0.0433943, 0.578655, 0.998349, - 0.0223108, 0.0426529, 0.60758, 0.99843, - 0.0223088, 0.042, 0.635524, 0.998373, - 0.0241141, 0.0418987, 0.663621, 0.998425, - 0.0231446, 0.0408118, 0.691906, 0.998504, - 0.0233684, 0.0400565, 0.719339, 0.998443, - 0.0241652, 0.0394634, 0.74643, 0.99848, - 0.0228715, 0.0380002, 0.773086, 0.998569, - 0.023519, 0.0372322, 0.798988, 0.998619, - 0.0223108, 0.0356468, 0.824249, 0.998594, - 0.0223105, 0.034523, 0.848808, 0.998622, - 0.0213426, 0.0328887, 0.87227, 0.998669, - 0.0207912, 0.0314374, 0.895157, 0.998705, - 0.0198416, 0.0296925, 0.916769, 0.998786, - 0.0189168, 0.0279634, 0.937773, 0.998888, - 0.0178811, 0.0261597, 0.957431, 0.99906, - 0.0166845, 0.0242159, 0.976495, 0.999038, - 0.0155464, 0.0222638, 0.994169, 0.999237, - 0.0141349, 0.0201967, 1.01112, 0.999378, - 0.0129324, 0.0181744, 1.02692, 0.999433, - 0.0113192, 0.0159898, 1.04174, 0.999439, - 0.0101244, 0.0140385, 1.05559, 0.999614, - 0.00837456, 0.0117826, 1.06852, 0.999722, - 0.00721769, 0.00983745, 1.08069, 0.999817, - 0.00554067, 0.00769002, 1.09176, 0.99983, - 0.00426961, 0.005782, 1.10211, 0.999964, - 0.00273904, 0.00374503, 1.11152, 1.00001, - 0.00136739, 0.00187176, 1.12031, 0.999946, 3.93227e-05, - 2.8919e-05, 1.12804, 0.995847, - 1.3435e-06, 0.0671785, 1.9916e-05, 0.995464, - 3.38387e-05, 0.0671527, 0.000501622, 0.99547, - 0.000135355, 0.0671531, 0.00200649, 0.995471, - 0.00030455, 0.0671532, 0.00451461, 0.99547, - 0.000541423, 0.0671531, 0.008026, 0.995471, - 0.00084598, 0.0671531, 0.0125407, 0.99547, - 0.00121823, 0.0671531, 0.0180589, 0.99547, - 0.00165817, 0.0671531, 0.0245806, 0.995463, - 0.00216583, 0.0671526, 0.0321062, 0.995468, - 0.00274127, 0.0671527, 0.0406366, 0.995474, - 0.00338447, 0.0671534, 0.0501717, 0.995473, - 0.00409554, 0.0671533, 0.0607131, 0.995478, - 0.00487451, 0.0671531, 0.0722618, 0.995476, - 0.00572148, 0.0671532, 0.0848191, 0.995477, - 0.00663658, 0.0671539, 0.0983882, 0.995498, - 0.00761986, 0.0671541, 0.112972, 0.995509, - 0.00867094, 0.0671542, 0.128568, 0.995509, - 0.00978951, 0.0671531, 0.145183, 0.995503, - 0.0109725, 0.0671491, 0.162808, 0.995501, - 0.012211, 0.0671465, 0.181441, 0.99553, - 0.0134565, 0.0671371, 0.201015, 0.99555, - 0.014391, 0.0670831, 0.221206, 0.99558, - 0.014351, 0.0668883, 0.240813, 0.995577, - 0.0173997, 0.0671055, 0.261257, 0.995602, - 0.0191111, 0.0671178, 0.284467, 0.995623, - 0.0206705, 0.0670946, 0.308765, 0.995658, - 0.022184, 0.0670472, 0.333905, 0.995705, - 0.0234832, 0.0669417, 0.359677, 0.995719, - 0.0241933, 0.0666714, 0.385554, 0.995786, - 0.0243539, 0.066266, 0.410951, 0.995887, - 0.0271866, 0.0664367, 0.437163, 0.995944, - 0.0296012, 0.0664931, 0.464842, 0.996004, - 0.0301045, 0.0660105, 0.49332, 0.996128, - 0.0298311, 0.0652694, 0.521131, 0.996253, - 0.0316426, 0.0650739, 0.549167, 0.996244, - 0.0339043, 0.0649433, 0.57737, 0.996309, - 0.033329, 0.0638926, 0.606073, 0.996417, - 0.0338935, 0.0630849, 0.634527, 0.996372, - 0.0353104, 0.0625083, 0.66256, 0.996542, - 0.0348942, 0.0611986, 0.690516, 0.996568, - 0.0351614, 0.060069, 0.718317, 0.996711, - 0.0354317, 0.0588522, 0.74528, 0.996671, - 0.0349513, 0.0571902, 0.772061, 0.996865, - 0.0345622, 0.0555321, 0.798089, 0.996802, - 0.0342566, 0.0537816, 0.823178, 0.996992, - 0.0330862, 0.0516095, 0.847949, 0.996944, - 0.0324666, 0.0495537, 0.871431, 0.997146, - 0.0309544, 0.0470302, 0.894357, 0.997189, - 0.0299372, 0.0446043, 0.916142, 0.997471, - 0.0281389, 0.0418812, 0.937193, 0.997515, - 0.0268702, 0.0391823, 0.957, 0.997812, - 0.0247166, 0.0361338, 0.975936, 0.998027, - 0.0233525, 0.0333945, 0.99391, 0.998233, - 0.0209839, 0.0301917, 1.01075, 0.998481, - 0.0194309, 0.027271, 1.02669, 0.998859, - 0.0169728, 0.0240162, 1.04173, 0.99894, - 0.0152322, 0.0210517, 1.05551, 0.999132, - 0.0127497, 0.0178632, 1.06856, 0.999369, - 0.0108282, 0.014787, 1.08054, 0.999549, - 0.00845886, 0.0116185, 1.09185, 0.999805, - 0.0063937, 0.00867209, 1.10207, 0.99985, - 0.00414582, 0.00566823, 1.1117, 0.999912, - 0.00207443, 0.00277562, 1.12022, 1.00001, 8.70226e-05, - 5.3766e-05, 1.12832, 0.991943, - 1.78672e-06, 0.0893382, 1.98384e-05, 0.991952, - 4.50183e-05, 0.089339, 0.000499849, 0.991956, - 0.000180074, 0.0893394, 0.0019994, 0.991955, - 0.000405167, 0.0893393, 0.00449867, 0.991953, - 0.000720298, 0.0893391, 0.00799764, 0.991955, - 0.00112548, 0.0893393, 0.0124964, 0.991957, - 0.0016207, 0.0893395, 0.0179951, 0.991958, - 0.00220601, 0.0893396, 0.0244939, 0.991947, - 0.00288137, 0.0893385, 0.0319929, 0.991962, - 0.00364693, 0.0893399, 0.0404933, 0.991965, - 0.00450264, 0.0893399, 0.049995, 0.99198, - 0.00544862, 0.0893411, 0.0604995, 0.99197, - 0.00648491, 0.0893397, 0.0720074, 0.991976, - 0.00761164, 0.089341, 0.0845207, 0.99198, - 0.00882891, 0.0893405, 0.0980413, 0.991982, - 0.0101367, 0.0893396, 0.112571, 0.992008, - 0.011535, 0.0893415, 0.128115, 0.992026, - 0.0130228, 0.0893414, 0.144672, 0.992064, - 0.0145966, 0.0893418, 0.162241, 0.992041, - 0.0162421, 0.0893359, 0.180801, 0.992086, - 0.0178888, 0.0893214, 0.200302, 0.992157, - 0.0190368, 0.0892401, 0.220332, 0.992181, - 0.0195584, 0.0890525, 0.240144, 0.992175, - 0.0227257, 0.0892153, 0.260728, 0.99221, - 0.0254195, 0.089304, 0.283473, 0.99222, - 0.0274883, 0.0892703, 0.307673, 0.992317, - 0.0294905, 0.0892027, 0.332729, 0.992374, - 0.0311861, 0.0890577, 0.358387, 0.992505, - 0.0320656, 0.0886994, 0.384102, 0.992568, - 0.0329715, 0.0883198, 0.409767, 0.992675, - 0.036006, 0.0883602, 0.436145, 0.992746, - 0.0392897, 0.0884591, 0.463217, 0.992873, - 0.0399337, 0.0878287, 0.491557, 0.992934, - 0.040231, 0.0870108, 0.519516, 0.993091, - 0.0422013, 0.0865857, 0.547741, 0.993259, - 0.0443503, 0.0861937, 0.575792, 0.993455, - 0.0446368, 0.0851187, 0.604233, 0.993497, - 0.0454299, 0.0840576, 0.632925, 0.993694, - 0.0463296, 0.0829671, 0.660985, 0.993718, - 0.0470619, 0.0817185, 0.688714, 0.993973, - 0.0468838, 0.0800294, 0.716743, 0.994207, - 0.046705, 0.0781286, 0.74377, 0.994168, - 0.0469698, 0.0763337, 0.77042, 0.9945, - 0.0456816, 0.0738184, 0.796659, 0.994356, - 0.0455518, 0.0715545, 0.821868, 0.994747, - 0.0439488, 0.0686085, 0.846572, 0.994937, - 0.0430056, 0.065869, 0.870435, 0.995142, - 0.0413414, 0.0626446, 0.893272, 0.995451, - 0.0396521, 0.05929, 0.915376, 0.995445, - 0.0378453, 0.0558503, 0.936196, 0.995967, - 0.0355219, 0.0520949, 0.956376, 0.996094, - 0.0335146, 0.048377, 0.975327, 0.996622, - 0.030682, 0.0442575, 0.993471, 0.996938, - 0.0285504, 0.0404693, 1.01052, 0.997383, - 0.0253399, 0.0360903, 1.02637, 0.997714, - 0.0231651, 0.0322176, 1.04139, 0.998249, - 0.0198138, 0.0278433, 1.05542, 0.998596, - 0.0174337, 0.0238759, 1.06846, 0.998946, - 0.0141349, 0.0195944, 1.08056, 0.99928, - 0.0115603, 0.0156279, 1.09181, 0.999507, - 0.00839065, 0.0114607, 1.10213, 0.999697, - 0.005666, 0.00763325, 1.11169, 0.999869, - 0.00269902, 0.00364946, 1.12042, 1.00001, 6.23836e-05, - 3.19288e-05, 1.12832, 0.987221, - 2.22675e-06, 0.111332, 1.97456e-05, 0.98739, - 5.61116e-05, 0.111351, 0.000497563, 0.987448, - 0.000224453, 0.111357, 0.00199031, 0.987441, - 0.000505019, 0.111357, 0.0044782, 0.987442, - 0.000897816, 0.111357, 0.00796129, 0.987442, - 0.00140284, 0.111357, 0.0124396, 0.987444, - 0.00202012, 0.111357, 0.0179132, 0.987442, - 0.00274964, 0.111357, 0.0243824, 0.987446, - 0.00359147, 0.111357, 0.0318474, 0.987435, - 0.00454562, 0.111356, 0.0403086, 0.987461, - 0.00561225, 0.111358, 0.0497678, 0.987458, - 0.00679125, 0.111358, 0.0602239, 0.987443, - 0.0080828, 0.111356, 0.0716792, 0.987476, - 0.0094872, 0.111358, 0.0841364, 0.98749, - 0.0110044, 0.111361, 0.097597, 0.987508, - 0.0126344, 0.111362, 0.112062, 0.987494, - 0.0143767, 0.111357, 0.127533, 0.987526, - 0.0162307, 0.111359, 0.144015, 0.987558, - 0.0181912, 0.111361, 0.161502, 0.987602, - 0.0202393, 0.111355, 0.179979, 0.987692, - 0.022273, 0.111346, 0.199386, 0.987702, - 0.0235306, 0.111215, 0.219183, 0.987789, - 0.0247628, 0.111061, 0.239202, 0.987776, - 0.0280668, 0.111171, 0.259957, 0.987856, - 0.0316751, 0.111327, 0.282198, 0.987912, - 0.0342468, 0.111282, 0.306294, 0.988, - 0.0367205, 0.111198, 0.331219, 0.988055, - 0.0387766, 0.110994, 0.356708, 0.988241, - 0.0397722, 0.110547, 0.382234, 0.988399, - 0.0416076, 0.110198, 0.408227, 0.988539, - 0.0448192, 0.110137, 0.434662, 0.988661, - 0.0483793, 0.110143, 0.461442, 0.988967, - 0.0495895, 0.109453, 0.489318, 0.989073, - 0.0506797, 0.108628, 0.517516, 0.989274, - 0.0526953, 0.108003, 0.545844, 0.989528, - 0.054578, 0.107255, 0.573823, 0.989709, - 0.0561503, 0.106294, 0.601944, 0.989991, - 0.056866, 0.104896, 0.630855, 0.990392, - 0.0572914, 0.103336, 0.658925, 0.990374, - 0.0586224, 0.10189, 0.686661, 0.990747, - 0.0584764, 0.099783, 0.714548, 0.991041, - 0.0582662, 0.0974309, 0.74186, 0.991236, - 0.0584118, 0.0951678, 0.768422, 0.991585, - 0.0573055, 0.0921581, 0.794817, 0.991984, - 0.0564241, 0.0891167, 0.820336, 0.9921, - 0.0553608, 0.085805, 0.84493, 0.992749, - 0.0533816, 0.0820354, 0.868961, 0.99288, - 0.0518661, 0.0782181, 0.891931, 0.993511, - 0.0492492, 0.0738935, 0.914186, 0.993617, - 0.0471956, 0.0696402, 0.93532, 0.99411, - 0.044216, 0.0649659, 0.95543, 0.994595, - 0.0416654, 0.0603177, 0.974685, 0.994976, - 0.0384314, 0.0553493, 0.992807, 0.995579, - 0.0353491, 0.0503942, 1.00996, 0.996069, - 0.0319787, 0.0452123, 1.02606, 0.996718, - 0.028472, 0.0400112, 1.04114, 0.997173, - 0.0250789, 0.0349456, 1.05517, 0.997818, - 0.0213326, 0.029653, 1.0683, 0.998318, - 0.0178509, 0.024549, 1.0805, 0.998853, - 0.0141118, 0.0194197, 1.09177, 0.999218, - 0.0105914, 0.0143869, 1.1022, 0.999594, - 0.00693474, 0.00943517, 1.11175, 0.99975, - 0.00340478, 0.00464051, 1.12056, 1.00001, 0.000109172, - 0.000112821, 1.12853, 0.983383, - 2.66524e-06, 0.133358, 1.96534e-05, 0.981942, - 6.71009e-05, 0.133162, 0.000494804, 0.981946, - 0.000268405, 0.133163, 0.00197923, 0.981944, - 0.000603912, 0.133163, 0.00445326, 0.981941, - 0.00107362, 0.133162, 0.00791693, 0.981946, - 0.00167755, 0.133163, 0.0123703, 0.981944, - 0.00241569, 0.133162, 0.0178135, 0.981945, - 0.00328807, 0.133163, 0.0242466, 0.981945, - 0.00429472, 0.133162, 0.03167, 0.981955, - 0.00543573, 0.133164, 0.0400846, 0.981951, - 0.00671105, 0.133163, 0.0494901, 0.981968, - 0.00812092, 0.133165, 0.0598886, 0.981979, - 0.00966541, 0.133166, 0.0712811, 0.981996, - 0.0113446, 0.133168, 0.083669, 0.982014, - 0.0131585, 0.133169, 0.0970533, 0.982011, - 0.0151073, 0.133167, 0.111438, 0.982062, - 0.0171906, 0.133172, 0.126826, 0.9821, - 0.0194067, 0.133175, 0.143215, 0.982149, - 0.0217502, 0.133176, 0.160609, 0.982163, - 0.0241945, 0.133173, 0.178981, 0.982247, - 0.0265907, 0.133148, 0.198249, 0.982291, - 0.027916, 0.132974, 0.217795, 0.982396, - 0.0299663, 0.132868, 0.238042, 0.982456, - 0.0334544, 0.132934, 0.258901, 0.982499, - 0.0378636, 0.133137, 0.280639, 0.982617, - 0.0409274, 0.133085, 0.304604, 0.98274, - 0.0438523, 0.132985, 0.329376, 0.982944, - 0.0462288, 0.132728, 0.354697, 0.98308, - 0.0475995, 0.132228, 0.380102, 0.983391, - 0.0501901, 0.131924, 0.406256, 0.983514, - 0.0535899, 0.131737, 0.432735, 0.98373, - 0.0571858, 0.131567, 0.459359, 0.984056, - 0.0592353, 0.130932, 0.486637, 0.984234, - 0.0610488, 0.130092, 0.51509, 0.984748, - 0.0630758, 0.12923, 0.543461, 0.985073, - 0.0647398, 0.128174, 0.571376, 0.985195, - 0.0671941, 0.127133, 0.599414, 0.985734, - 0.0681345, 0.125576, 0.628134, 0.986241, - 0.0686089, 0.123639, 0.656399, 0.986356, - 0.0698511, 0.121834, 0.684258, 0.986894, - 0.0700931, 0.119454, 0.711818, 0.987382, - 0.0698321, 0.116718, 0.739511, 0.988109, - 0.0693975, 0.113699, 0.766267, 0.988363, - 0.0689584, 0.110454, 0.792456, 0.989112, - 0.0672353, 0.106602, 0.81813, 0.989241, - 0.0662034, 0.10267, 0.842889, 0.990333, - 0.0638938, 0.0981381, 0.867204, 0.990591, - 0.0618534, 0.0935388, 0.89038, 0.991106, - 0.0593117, 0.088553, 0.912576, 0.991919, - 0.0562676, 0.0832187, 0.934118, 0.992111, - 0.0534085, 0.0778302, 0.954254, 0.992997, - 0.0495459, 0.0720453, 0.973722, 0.993317, - 0.0463707, 0.0663458, 0.991949, 0.994133, - 0.0421245, 0.0601883, 1.00936, 0.994705, - 0.0384977, 0.0542501, 1.02559, 0.995495, - 0.0340956, 0.0479862, 1.04083, 0.996206, - 0.030105, 0.041887, 1.05497, 0.996971, - 0.0256095, 0.0355355, 1.06824, 0.997796, - 0.0213932, 0.0293655, 1.08056, 0.998272, - 0.0169612, 0.0232926, 1.09182, 0.998857, - 0.0126756, 0.0172786, 1.10219, 0.99939, - 0.00832486, 0.0113156, 1.11192, 0.999752, - 0.00410826, 0.00557892, 1.12075, 1, 0.000150957, - 0.000119101, 1.12885, 0.975169, - 3.09397e-06, 0.154669, 1.95073e-05, 0.975439, - 7.79608e-05, 0.154712, 0.000491534, 0.975464, - 0.000311847, 0.154716, 0.00196617, 0.975464, - 0.000701656, 0.154716, 0.00442387, 0.975462, - 0.0012474, 0.154715, 0.0078647, 0.975461, - 0.00194906, 0.154715, 0.0122886, 0.975464, - 0.00280667, 0.154715, 0.0176959, 0.975468, - 0.00382025, 0.154716, 0.0240867, 0.975471, - 0.00498985, 0.154716, 0.0314612, 0.975472, - 0.00631541, 0.154717, 0.0398199, 0.975486, - 0.00779719, 0.154718, 0.0491639, 0.975489, - 0.00943505, 0.154718, 0.0594932, 0.975509, - 0.0112295, 0.154721, 0.0708113, 0.97554, - 0.0131802, 0.154724, 0.0831176, 0.975557, - 0.0152876, 0.154726, 0.096415, 0.975585, - 0.0175512, 0.154728, 0.110705, 0.975605, - 0.0199713, 0.154729, 0.125992, 0.975645, - 0.0225447, 0.154729, 0.142272, 0.975711, - 0.0252649, 0.154735, 0.159549, 0.975788, - 0.0280986, 0.154736, 0.177805, 0.975872, - 0.0308232, 0.154704, 0.196911, 0.975968, - 0.0324841, 0.154525, 0.216324, 0.976063, - 0.0351281, 0.154432, 0.236628, 0.976157, - 0.0388618, 0.15446, 0.257539, 0.976204, - 0.0437704, 0.154665, 0.278975, 0.976358, - 0.047514, 0.154652, 0.302606, 0.976571, - 0.0508638, 0.154535, 0.327204, 0.976725, - 0.0534995, 0.154221, 0.352276, 0.977013, - 0.0555547, 0.153737, 0.377696, 0.977294, - 0.0586728, 0.153403, 0.403855, 0.977602, - 0.0622715, 0.15312, 0.430333, 0.977932, - 0.0658166, 0.152755, 0.456855, 0.978241, - 0.0689877, 0.152233, 0.483668, 0.978602, - 0.0712805, 0.15132, 0.512097, 0.979234, - 0.0732775, 0.150235, 0.540455, 0.97977, - 0.075163, 0.148978, 0.568486, 0.979995, - 0.0778026, 0.147755, 0.596524, 0.98078, - 0.0791854, 0.146019, 0.624825, 0.981628, - 0.0799666, 0.143906, 0.653403, 0.982067, - 0.0808532, 0.141561, 0.681445, 0.98271, - 0.0816024, 0.139025, 0.708918, 0.983734, - 0.0812511, 0.135764, 0.736594, 0.98431, - 0.0806201, 0.132152, 0.763576, 0.985071, - 0.0801605, 0.12846, 0.789797, 0.98618, - 0.0784208, 0.124084, 0.815804, 0.986886, - 0.0766643, 0.1193, 0.840869, 0.987485, - 0.0747744, 0.114236, 0.864952, 0.988431, - 0.0716701, 0.108654, 0.888431, 0.988886, - 0.0691609, 0.102994, 0.910963, 0.990024, - 0.0654048, 0.0967278, 0.932629, 0.990401, - 0.0619765, 0.090384, 0.95313, 0.991093, - 0.0579296, 0.0837885, 0.972587, 0.992018, - 0.0536576, 0.0770171, 0.991184, 0.992536, - 0.0493719, 0.0701486, 1.00863, 0.993421, - 0.0444813, 0.062953, 1.02494, 0.993928, - 0.040008, 0.0560455, 1.04017, 0.994994, - 0.0347982, 0.04856, 1.05463, 0.995866, - 0.0301017, 0.0416152, 1.06807, 0.996916, - 0.0248225, 0.0342597, 1.08039, 0.997766, - 0.0199229, 0.0271668, 1.09177, 0.998479, - 0.0147422, 0.0201387, 1.10235, 0.99921, - 0.00980173, 0.0131944, 1.11206, 0.999652, - 0.0047426, 0.00640712, 1.12104, 0.999998, 8.91673e-05, - 0.00010379, 1.12906, 0.967868, - 3.51885e-06, 0.175947, 1.93569e-05, 0.968001, - 8.86733e-05, 0.175972, 0.000487782, 0.96801, - 0.000354697, 0.175973, 0.00195115, 0.968012, - 0.000798063, 0.175974, 0.00439006, 0.968011, - 0.00141879, 0.175973, 0.00780461, 0.968011, - 0.00221686, 0.175973, 0.0121948, 0.968016, - 0.00319231, 0.175974, 0.0175607, 0.968019, - 0.00434515, 0.175974, 0.0239027, 0.968018, - 0.00567538, 0.175974, 0.0312208, 0.968033, - 0.00718308, 0.175977, 0.0395158, 0.968049, - 0.00886836, 0.175979, 0.0487885, 0.968047, - 0.0107312, 0.175978, 0.0590394, 0.968072, - 0.0127719, 0.175981, 0.0702705, 0.968108, - 0.0149905, 0.175986, 0.0824836, 0.968112, - 0.0173866, 0.175985, 0.0956783, 0.968173, - 0.0199611, 0.175993, 0.109862, 0.96827, - 0.0227128, 0.176008, 0.125033, 0.968292, - 0.025639, 0.17601, 0.141193, 0.968339, - 0.0287299, 0.176007, 0.158336, 0.968389, - 0.0319399, 0.176001, 0.176441, 0.968501, - 0.034941, 0.175962, 0.195359, 0.968646, - 0.0370812, 0.175793, 0.214686, 0.968789, - 0.0402329, 0.175708, 0.234973, 0.96886, - 0.0442601, 0.1757, 0.255871, 0.969013, - 0.049398, 0.175876, 0.277238, 0.969242, - 0.0539932, 0.17594, 0.300326, 0.969419, - 0.0577299, 0.175781, 0.324702, 0.969763, - 0.0605643, 0.175432, 0.349527, 0.970093, - 0.0634488, 0.174992, 0.374976, 0.970361, - 0.0670589, 0.174611, 0.401097, 0.970825, - 0.0708246, 0.174226, 0.427496, 0.971214, - 0.0742871, 0.173684, 0.453858, 0.971622, - 0.0782608, 0.173186, 0.480637, 0.972175, - 0.0813151, 0.172288, 0.508655, 0.972944, - 0.0832678, 0.170979, 0.536973, 0.973595, - 0.0855964, 0.169573, 0.565138, 0.974345, - 0.0882163, 0.168152, 0.593222, 0.975233, - 0.0901671, 0.166314, 0.621201, 0.976239, - 0.0912111, 0.163931, 0.649919, 0.977289, - 0.0916959, 0.161106, 0.678011, 0.978076, - 0.0927061, 0.158272, 0.705717, 0.979533, - 0.0925562, 0.15475, 0.733228, 0.980335, - 0.0918159, 0.150638, 0.760454, 0.981808, - 0.0908508, 0.146201, 0.786918, 0.983061, - 0.0896172, 0.141386, 0.812953, 0.984148, - 0.0871588, 0.135837, 0.838281, 0.985047, - 0.0850624, 0.130135, 0.862594, 0.986219, - 0.0818541, 0.123882, 0.88633, 0.987043, - 0.0784523, 0.117126, 0.908952, 0.988107, - 0.0749601, 0.110341, 0.930744, 0.988955, - 0.0703548, 0.102885, 0.951728, 0.989426, - 0.0662798, 0.0954167, 0.971166, 0.990421, - 0.0610834, 0.0876331, 0.989984, 0.991032, - 0.0562936, 0.0797785, 1.00765, 0.992041, - 0.0508154, 0.0718166, 1.02434, 0.992794, - 0.0454045, 0.0637125, 1.03976, 0.993691, - 0.0398194, 0.0555338, 1.05418, 0.994778, - 0.0341482, 0.0473388, 1.06772, 0.995915, - 0.028428, 0.0391016, 1.08028, 0.997109, - 0.022642, 0.0309953, 1.09185, 0.998095, - 0.0168738, 0.0230288, 1.10247, 0.998985, - 0.0111274, 0.0150722, 1.11229, 0.999581, - 0.00543881, 0.00740605, 1.12131, 1.00003, 0.000162239, - 0.000105549, 1.12946, 0.959505, - 3.93734e-06, 0.196876, 1.91893e-05, 0.959599, - 9.92157e-05, 0.196895, 0.000483544, 0.959641, - 0.000396868, 0.196903, 0.0019342, 0.959599, - 0.000892948, 0.196895, 0.00435193, 0.959603, - 0.00158747, 0.196896, 0.0077368, 0.959604, - 0.00248042, 0.196896, 0.0120888, 0.959605, - 0.00357184, 0.196896, 0.0174082, 0.959605, - 0.00486169, 0.196896, 0.0236949, 0.959613, - 0.00635008, 0.196897, 0.0309497, 0.959619, - 0.00803696, 0.196898, 0.0391725, 0.959636, - 0.00992255, 0.196901, 0.0483649, 0.959634, - 0.0120067, 0.1969, 0.0585266, 0.959675, - 0.0142898, 0.196906, 0.0696609, 0.959712, - 0.0167717, 0.196911, 0.0817678, 0.959752, - 0.0194524, 0.196918, 0.0948494, 0.959807, - 0.0223321, 0.196925, 0.10891, 0.959828, - 0.0254091, 0.196924, 0.123947, 0.959906, - 0.0286815, 0.196934, 0.139968, 0.960005, - 0.0321371, 0.196944, 0.156968, 0.960071, - 0.0357114, 0.196936, 0.17491, 0.960237, - 0.0389064, 0.196882, 0.193597, 0.960367, - 0.041623, 0.196731, 0.21285, 0.960562, - 0.0452655, 0.196654, 0.233075, 0.960735, - 0.0496207, 0.196643, 0.253941, 0.960913, - 0.0549379, 0.196774, 0.275278, 0.961121, - 0.0603414, 0.196893, 0.297733, 0.96139, - 0.0644244, 0.196717, 0.321877, 0.961818, - 0.067556, 0.196314, 0.346476, 0.962175, - 0.0712709, 0.195917, 0.371907, 0.96255, - 0.0752848, 0.1955, 0.397916, 0.963164, - 0.0792073, 0.195026, 0.424229, 0.963782, - 0.0828225, 0.194424, 0.450637, 0.964306, - 0.0873119, 0.193831, 0.477288, 0.964923, - 0.0911051, 0.192973, 0.504716, 0.966048, - 0.093251, 0.19151, 0.533053, 0.967024, - 0.0958983, 0.190013, 0.561366, 0.968038, - 0.09835, 0.188253, 0.589464, 0.969152, - 0.100754, 0.186257, 0.617433, 0.970557, - 0.102239, 0.183775, 0.645801, 0.972104, - 0.102767, 0.180645, 0.674278, 0.973203, - 0.103492, 0.177242, 0.702004, 0.975123, - 0.103793, 0.17345, 0.729529, 0.97641, - 0.102839, 0.168886, 0.756712, 0.978313, - 0.101687, 0.163892, 0.783801, 0.980036, - 0.100314, 0.158439, 0.809671, 0.981339, - 0.097836, 0.152211, 0.835402, 0.982794, - 0.0950006, 0.145679, 0.860081, 0.984123, - 0.0920994, 0.138949, 0.883757, 0.984918, - 0.0878641, 0.131283, 0.90685, 0.985999, - 0.083939, 0.123464, 0.928786, 0.987151, - 0.0791234, 0.115324, 0.94983, 0.987827, - 0.0739332, 0.106854, 0.96962, 0.988806, - 0.0688088, 0.0982691, 0.98861, 0.989588, - 0.0628962, 0.0893456, 1.00667, 0.990438, - 0.0573146, 0.0805392, 1.02344, 0.991506, - 0.0509433, 0.0713725, 1.03933, 0.992492, - 0.0448724, 0.0623732, 1.05378, 0.993663, - 0.0383497, 0.0530838, 1.06747, 0.994956, - 0.0319593, 0.0439512, 1.08007, 0.99634, - 0.025401, 0.0347803, 1.09182, 0.99761, - 0.0189687, 0.0257954, 1.1025, 0.99863, - 0.0124441, 0.0169893, 1.11247, 0.99947, - 0.00614003, 0.00829498, 1.12151, 1.00008, 0.000216624, - 0.000146107, 1.12993, 0.950129, - 4.34955e-06, 0.217413, 1.90081e-05, 0.950264, - 0.00010957, 0.217444, 0.00047884, 0.9503, - 0.000438299, 0.217451, 0.00191543, 0.950246, - 0.000986124, 0.21744, 0.00430951, 0.950246, - 0.00175311, 0.21744, 0.00766137, 0.950245, - 0.00273923, 0.21744, 0.011971, 0.950253, - 0.00394453, 0.217441, 0.0172385, 0.950258, - 0.00536897, 0.217442, 0.0234641, 0.950267, - 0.00701262, 0.217444, 0.030648, 0.950277, - 0.00887551, 0.217446, 0.038791, 0.950284, - 0.0109576, 0.217446, 0.0478931, 0.950312, - 0.0132591, 0.217451, 0.0579568, 0.950334, - 0.01578, 0.217454, 0.0689821, 0.950378, - 0.0185204, 0.217462, 0.0809714, 0.950417, - 0.0214803, 0.217467, 0.0939265, 0.950488, - 0.0246594, 0.217479, 0.10785, 0.950534, - 0.0280565, 0.217483, 0.122743, 0.950633, - 0.0316685, 0.217498, 0.138611, 0.950698, - 0.0354787, 0.217499, 0.155442, 0.950844, - 0.0394003, 0.217507, 0.173208, 0.950999, - 0.0426812, 0.217419, 0.191605, 0.951221, - 0.0461302, 0.217317, 0.21084, 0.951412, - 0.0502131, 0.217238, 0.230945, 0.951623, - 0.0549183, 0.21722, 0.251745, 0.951867, - 0.0604493, 0.217306, 0.273001, 0.952069, - 0.0665189, 0.217466, 0.294874, 0.952459, - 0.0709179, 0.217266, 0.318732, 0.952996, - 0.0746112, 0.216891, 0.34318, 0.953425, - 0.0789252, 0.216503, 0.36849, 0.953885, - 0.0833293, 0.216042, 0.394373, 0.954617, - 0.087371, 0.215469, 0.420505, 0.955429, - 0.0914054, 0.214802, 0.446907, 0.956068, - 0.0961671, 0.214146, 0.473522, 0.957094, - 0.10048, 0.213286, 0.50052, 0.958372, - 0.103248, 0.211796, 0.528715, 0.959654, - 0.106033, 0.21016, 0.557065, 0.961305, - 0.108384, 0.208149, 0.585286, 0.962785, - 0.111122, 0.206024, 0.613334, 0.964848, - 0.112981, 0.203442, 0.641334, 0.966498, - 0.113717, 0.19996, 0.669955, 0.968678, - 0.114121, 0.196105, 0.698094, 0.970489, - 0.114524, 0.191906, 0.725643, 0.972903, - 0.113792, 0.186963, 0.752856, 0.974701, - 0.112406, 0.181343, 0.780013, 0.976718, - 0.110685, 0.175185, 0.806268, 0.978905, - 0.108468, 0.168535, 0.832073, 0.980267, - 0.105061, 0.161106, 0.857149, 0.981967, - 0.101675, 0.153387, 0.881145, 0.983063, - 0.0974492, 0.145199, 0.904255, 0.984432, - 0.0925815, 0.136527, 0.926686, 0.985734, - 0.0877983, 0.127584, 0.947901, 0.986228, - 0.081884, 0.118125, 0.968111, 0.98719, - 0.0761208, 0.108594, 0.98719, 0.988228, - 0.0698196, 0.0989996, 1.00559, 0.989046, - 0.0632739, 0.0890074, 1.02246, 0.990242, - 0.056522, 0.0790832, 1.03841, 0.991252, - 0.0495272, 0.0689182, 1.05347, 0.992542, - 0.0425373, 0.0588592, 1.06724, 0.994096, - 0.0353198, 0.0486833, 1.08009, 0.995593, - 0.028235, 0.0385977, 1.09177, 0.99711, - 0.0209511, 0.0286457, 1.10274, 0.998263, - 0.0139289, 0.0188497, 1.11262, 0.999254, - 0.0067359, 0.009208, 1.12191, 0.999967, 0.000141846, - 6.57764e-05, 1.13024, 0.935608, - 4.74692e-06, 0.236466, 1.87817e-05, 0.93996, - 0.00011971, 0.237568, 0.000473646, 0.939959, - 0.000478845, 0.237567, 0.0018946, 0.939954, - 0.0010774, 0.237566, 0.00426284, 0.939956, - 0.00191538, 0.237566, 0.00757842, 0.939954, - 0.00299277, 0.237566, 0.0118413, 0.93996, - 0.00430961, 0.237567, 0.0170518, 0.939969, - 0.00586589, 0.237569, 0.02321, 0.939982, - 0.00766166, 0.237572, 0.0303164, 0.939987, - 0.00969686, 0.237572, 0.0383711, 0.939997, - 0.0119715, 0.237574, 0.0473751, 0.940031, - 0.0144858, 0.237581, 0.0573298, 0.940073, - 0.0172399, 0.237589, 0.0682366, 0.94012, - 0.0202335, 0.237598, 0.080097, 0.940162, - 0.0234663, 0.237604, 0.0929116, 0.940237, - 0.0269387, 0.237615, 0.106686, 0.940328, - 0.0306489, 0.237632, 0.121421, 0.940419, - 0.0345917, 0.237645, 0.137115, 0.940522, - 0.0387481, 0.237654, 0.153766, 0.940702, - 0.0429906, 0.237661, 0.17133, 0.940871, - 0.0465089, 0.237561, 0.189502, 0.941103, - 0.050531, 0.23748, 0.208616, 0.941369, - 0.0550657, 0.237423, 0.228595, 0.941641, - 0.0601337, 0.237399, 0.249287, 0.941903, - 0.0658804, 0.237443, 0.270467, 0.942224, - 0.0722674, 0.237597, 0.292024, 0.942633, - 0.0771788, 0.237419, 0.315272, 0.943172, - 0.0815623, 0.237068, 0.339579, 0.943691, - 0.0863973, 0.236682, 0.364717, 0.944382, - 0.0911536, 0.236213, 0.390435, 0.945392, - 0.0952967, 0.235562, 0.416425, 0.946185, - 0.0998948, 0.234832, 0.442772, 0.947212, - 0.104796, 0.234114, 0.469347, 0.948778, - 0.10928, 0.233222, 0.496162, 0.950149, - 0.113081, 0.231845, 0.523978, 0.951989, - 0.115893, 0.230005, 0.552295, 0.953921, - 0.11846, 0.227862, 0.580569, 0.955624, - 0.12115, 0.225439, 0.608698, 0.958234, - 0.123373, 0.222635, 0.636696, 0.960593, - 0.124519, 0.219093, 0.665208, 0.963201, - 0.124736, 0.214749, 0.693557, 0.965642, - 0.125012, 0.210059, 0.721334, 0.968765, - 0.124661, 0.204935, 0.748613, 0.971753, - 0.122996, 0.198661, 0.776224, 0.973751, - 0.120998, 0.191823, 0.802461, 0.976709, - 0.118583, 0.184359, 0.828399, 0.977956, - 0.115102, 0.176437, 0.853693, 0.979672, - 0.111077, 0.167681, 0.877962, 0.981816, - 0.10688, 0.158872, 0.901564, 0.98238, - 0.101469, 0.149398, 0.924057, 0.983964, - 0.0960013, 0.139436, 0.945751, 0.984933, - 0.0899626, 0.12943, 0.966272, 0.985694, - 0.0832973, 0.11894, 0.985741, 0.986822, - 0.0767082, 0.108349, 1.00407, 0.987725, - 0.0693614, 0.0976026, 1.02154, 0.98877, - 0.06211, 0.086652, 1.03757, 0.990129, - 0.0544143, 0.0756182, 1.05296, 0.991337, - 0.046744, 0.0645753, 1.06683, 0.992978, - 0.0387931, 0.0534683, 1.0798, 0.994676, - 0.030973, 0.0424137, 1.09181, 0.99645, - 0.0230311, 0.0314035, 1.10286, 0.997967, - 0.0152065, 0.0206869, 1.11291, 0.99922, - 0.00744837, 0.010155, 1.12237, 1.00002, 0.000240209, - 7.52767e-05, 1.13089, 0.922948, - 5.15351e-06, 0.255626, 1.86069e-05, 0.928785, - 0.000129623, 0.257244, 0.000468009, 0.928761, - 0.00051849, 0.257237, 0.00187202, 0.928751, - 0.0011666, 0.257235, 0.00421204, 0.928751, - 0.00207395, 0.257234, 0.0074881, 0.928754, - 0.00324055, 0.257235, 0.0117002, 0.92876, - 0.00466639, 0.257236, 0.0168486, 0.928763, - 0.00635149, 0.257237, 0.0229334, 0.928774, - 0.00829584, 0.257239, 0.029955, 0.928791, - 0.0104995, 0.257243, 0.0379139, 0.928804, - 0.0129623, 0.257245, 0.0468108, 0.928847, - 0.0156846, 0.257255, 0.0566473, 0.92889, - 0.0186661, 0.257263, 0.0674246, 0.928924, - 0.0219067, 0.257268, 0.0791433, 0.928989, - 0.0254066, 0.257282, 0.0918076, 0.92909, - 0.0291651, 0.257301, 0.105419, 0.92918, - 0.0331801, 0.257316, 0.119978, 0.92929, - 0.0374469, 0.257332, 0.135491, 0.929453, - 0.041939, 0.257357, 0.151948, 0.929586, - 0.0464612, 0.257347, 0.169275, 0.929858, - 0.0503426, 0.257269, 0.187257, 0.930125, - 0.0548409, 0.257199, 0.206204, 0.930403, - 0.0598063, 0.257149, 0.22601, 0.930726, - 0.0652437, 0.257122, 0.246561, 0.931098, - 0.0712376, 0.257153, 0.267618, 0.931396, - 0.0777506, 0.257237, 0.288993, 0.931947, - 0.0832374, 0.257124, 0.311527, 0.932579, - 0.0883955, 0.25683, 0.335697, 0.933194, - 0.0937037, 0.256444, 0.360634, 0.934013, - 0.0987292, 0.255939, 0.386126, 0.935307, - 0.103215, 0.255282, 0.412018, 0.936374, - 0.108234, 0.254538, 0.438292, 0.93776, - 0.113234, 0.253728, 0.464805, 0.939599, - 0.118013, 0.25275, 0.491464, 0.941036, - 0.122661, 0.251404, 0.518751, 0.94337, - 0.125477, 0.249435, 0.547133, 0.945318, - 0.128374, 0.247113, 0.575456, 0.947995, - 0.130996, 0.244441, 0.60372, 0.950818, - 0.133438, 0.241352, 0.63174, 0.954378, - 0.135004, 0.237849, 0.659971, 0.957151, - 0.135313, 0.233188, 0.688478, 0.960743, - 0.13521, 0.228001, 0.716767, 0.964352, - 0.135007, 0.222249, 0.744349, 0.967273, - 0.133523, 0.21542, 0.771786, 0.969767, - 0.131155, 0.208039, 0.798639, 0.973195, - 0.128492, 0.200076, 0.824774, 0.975557, - 0.125094, 0.191451, 0.850222, 0.977692, - 0.120578, 0.18184, 0.874761, 0.98026, - 0.115882, 0.172102, 0.898497, 0.981394, - 0.110372, 0.161859, 0.921636, 0.982386, - 0.10415, 0.15108, 0.943467, 0.983783, - 0.0978128, 0.140407, 0.964045, 0.98422, - 0.0906171, 0.129058, 0.98398, 0.985447, - 0.0832921, 0.117614, 1.00276, 0.986682, - 0.0754412, 0.10585, 1.02047, 0.987326, - 0.0673885, 0.0940943, 1.03678, 0.988707, - 0.0592565, 0.0822093, 1.05218, 0.990185, - 0.050717, 0.070192, 1.06652, 0.991866, - 0.0423486, 0.0582081, 1.07965, 0.993897, - 0.0336118, 0.0460985, 1.09188, 0.995841, - 0.0252178, 0.0342737, 1.10307, 0.997605, - 0.0164893, 0.0224829, 1.11324, 0.999037, - 0.00817112, 0.0110647, 1.12262, 1.00003, 0.000291686, - 0.000168673, 1.13139, 0.915304, - 5.52675e-06, 0.275999, 1.83285e-05, 0.91668, - 0.000139285, 0.276414, 0.000461914, 0.916664, - 0.00055713, 0.276409, 0.00184763, 0.916653, - 0.00125354, 0.276406, 0.00415715, 0.916651, - 0.00222851, 0.276405, 0.00739053, 0.916655, - 0.00348205, 0.276406, 0.0115478, 0.916653, - 0.00501414, 0.276405, 0.0166291, 0.916667, - 0.00682478, 0.276409, 0.0226346, 0.91668, - 0.00891398, 0.276412, 0.0295648, 0.91669, - 0.0112817, 0.276413, 0.0374199, 0.916727, - 0.013928, 0.276422, 0.0462016, 0.916759, - 0.0168528, 0.276429, 0.0559101, 0.916793, - 0.0200558, 0.276436, 0.0665466, 0.916849, - 0.0235373, 0.276448, 0.0781139, 0.916964, - 0.0272973, 0.276474, 0.0906156, 0.917047, - 0.0313344, 0.276491, 0.104051, 0.917152, - 0.0356465, 0.276511, 0.118424, 0.917286, - 0.0402271, 0.276533, 0.133736, 0.917469, - 0.0450408, 0.276564, 0.149978, 0.917686, - 0.0497872, 0.276563, 0.167057, 0.917953, - 0.0540937, 0.276493, 0.184846, 0.918228, - 0.0590709, 0.276437, 0.203614, 0.918572, - 0.0644277, 0.276398, 0.223212, 0.918918, - 0.0702326, 0.276362, 0.243584, 0.919356, - 0.076484, 0.276383, 0.264465, 0.919842, - 0.0830808, 0.276434, 0.285701, 0.920451, - 0.0892972, 0.276407, 0.307559, 0.921113, - 0.095016, 0.276128, 0.331501, 0.921881, - 0.100771, 0.275754, 0.356207, 0.923027, - 0.106029, 0.275254, 0.381477, 0.924364, - 0.111029, 0.274595, 0.40722, 0.925818, - 0.116345, 0.273841, 0.433385, 0.92746, - 0.121424, 0.272913, 0.459848, 0.929167, - 0.12657, 0.271837, 0.486493, 0.931426, - 0.131581, 0.270575, 0.513432, 0.934001, - 0.135038, 0.268512, 0.541502, 0.936296, - 0.138039, 0.266135, 0.569658, 0.939985, - 0.140687, 0.263271, 0.598375, 0.943516, - 0.143247, 0.260058, 0.626563, 0.94782, - 0.145135, 0.256138, 0.654711, 0.951023, - 0.145733, 0.251154, 0.683285, 0.955338, - 0.145554, 0.245562, 0.711831, 0.959629, - 0.145008, 0.239265, 0.739573, 0.963123, - 0.144003, 0.232064, 0.767027, 0.966742, - 0.141289, 0.224036, 0.794359, 0.969991, - 0.138247, 0.215305, 0.820361, 0.973403, - 0.134786, 0.206051, 0.846548, 0.975317, - 0.129966, 0.195914, 0.871541, 0.977647, - 0.12471, 0.185184, 0.895313, 0.980137, - 0.119086, 0.174161, 0.918398, 0.981031, - 0.112297, 0.162792, 0.940679, 0.982037, - 0.105372, 0.150952, 0.961991, 0.983164, - 0.097821, 0.138921, 0.981913, 0.983757, - 0.0897245, 0.126611, 1.00109, 0.985036, - 0.0815974, 0.114228, 1.01902, 0.986289, - 0.0727725, 0.101389, 1.03604, 0.987329, - 0.0639323, 0.0886476, 1.05149, 0.989193, - 0.0548109, 0.0756837, 1.06619, 0.990716, - 0.045687, 0.0627581, 1.07948, 0.992769, - 0.0364315, 0.0498337, 1.09172, 0.99524, - 0.0271761, 0.0370305, 1.1033, 0.997154, - 0.0179609, 0.0243959, 1.11353, 0.998845, - 0.00878063, 0.0119567, 1.12319, 1.00002, 0.000259038, - 0.000108146, 1.13177, 0.903945, - 5.91681e-06, 0.295126, 1.81226e-05, 0.903668, - 0.000148672, 0.295037, 0.000455367, 0.903677, - 0.000594683, 0.29504, 0.00182145, 0.903673, - 0.00133805, 0.295039, 0.00409831, 0.903666, - 0.00237872, 0.295036, 0.00728584, 0.903668, - 0.00371676, 0.295037, 0.0113842, 0.903679, - 0.00535212, 0.29504, 0.0163936, 0.903684, - 0.00728479, 0.295041, 0.0223141, 0.903698, - 0.00951473, 0.295044, 0.0291462, 0.903718, - 0.0120419, 0.295049, 0.0368904, 0.903754, - 0.0148664, 0.295058, 0.0455477, 0.903801, - 0.017988, 0.29507, 0.0551194, 0.903851, - 0.0214064, 0.295082, 0.0656058, 0.903921, - 0.0251219, 0.295097, 0.0770109, 0.904002, - 0.0291337, 0.295116, 0.0893354, 0.904111, - 0.033441, 0.29514, 0.102583, 0.904246, - 0.0380415, 0.295169, 0.116755, 0.904408, - 0.0429258, 0.295202, 0.131853, 0.904637, - 0.0480468, 0.295245, 0.147869, 0.904821, - 0.0529208, 0.295214, 0.164658, 0.905163, - 0.0577748, 0.295185, 0.182274, 0.905469, - 0.0631763, 0.295143, 0.200828, 0.905851, - 0.068917, 0.295112, 0.2202, 0.906322, - 0.0750861, 0.295104, 0.240372, 0.906761, - 0.0815855, 0.295086, 0.261082, 0.90735, - 0.0882138, 0.295095, 0.282123, 0.908087, - 0.095082, 0.295139, 0.303563, 0.908826, - 0.101488, 0.29492, 0.327028, 0.909832, - 0.107577, 0.294577, 0.351464, 0.911393, - 0.113033, 0.294115, 0.376497, 0.912804, - 0.118629, 0.293446, 0.402115, 0.914081, - 0.124232, 0.292581, 0.428111, 0.91637, - 0.129399, 0.29166, 0.454442, 0.91814, - 0.134892, 0.290422, 0.481024, 0.921179, - 0.140069, 0.289194, 0.507924, 0.924544, - 0.144431, 0.287421, 0.535557, 0.927995, - 0.147498, 0.284867, 0.563984, 0.931556, - 0.150197, 0.281722, 0.5923, 0.935777, - 0.152711, 0.278207, 0.620832, 0.940869, - 0.154836, 0.274148, 0.649069, 0.945994, - 0.155912, 0.269057, 0.677746, 0.949634, - 0.155641, 0.262799, 0.706293, 0.955032, - 0.154809, 0.256097, 0.734278, 0.95917, - 0.153678, 0.248618, 0.761751, 0.962931, - 0.151253, 0.239794, 0.789032, 0.966045, - 0.147625, 0.230281, 0.815422, 0.96971, - 0.143964, 0.220382, 0.841787, 0.972747, - 0.139464, 0.209846, 0.867446, 0.975545, - 0.133459, 0.198189, 0.892004, 0.978381, - 0.127424, 0.186362, 0.915458, 0.979935, - 0.120506, 0.173964, 0.937948, 0.980948, - 0.11282, 0.161429, 0.959732, 0.982234, - 0.104941, 0.148557, 0.980118, 0.982767, - 0.0962905, 0.135508, 0.999463, 0.983544, - 0.0873625, 0.122338, 1.01756, 0.984965, - 0.0783447, 0.108669, 1.03492, 0.986233, - 0.0684798, 0.0949911, 1.05087, 0.987796, - 0.0590867, 0.0811386, 1.0656, 0.989885, - 0.0489145, 0.0673099, 1.0794, 0.991821, - 0.0391, 0.0535665, 1.09174, 0.99448, - 0.029087, 0.0397529, 1.10341, 0.996769, - 0.019114, 0.0261463, 1.11383, 0.998641, - 0.00947007, 0.0128731, 1.1237, 0.999978, 0.000446316, - 0.000169093, 1.13253, 0.888362, - 6.27064e-06, 0.312578, 1.78215e-05, 0.889988, - 0.000157791, 0.313148, 0.000448451, 0.889825, - 0.000631076, 0.313092, 0.00179356, 0.88984, - 0.00141994, 0.313097, 0.00403554, 0.889828, - 0.0025243, 0.313092, 0.00717429, 0.889831, - 0.00394421, 0.313093, 0.0112099, 0.889831, - 0.00567962, 0.313093, 0.0161425, 0.889844, - 0.00773051, 0.313096, 0.0219724, 0.889858, - 0.0100968, 0.3131, 0.0286999, 0.889882, - 0.0127786, 0.313106, 0.0363256, 0.889918, - 0.0157757, 0.313116, 0.0448509, 0.889967, - 0.0190878, 0.313129, 0.0542758, 0.89003, - 0.022715, 0.313145, 0.0646032, 0.890108, - 0.0266566, 0.313165, 0.0758339, 0.890218, - 0.0309131, 0.313193, 0.0879729, 0.890351, - 0.0354819, 0.313226, 0.101019, 0.89051, - 0.0403613, 0.313263, 0.114979, 0.890672, - 0.0455385, 0.313294, 0.129848, 0.890882, - 0.0509444, 0.313333, 0.145616, 0.891189, - 0.0559657, 0.313324, 0.162122, 0.891457, - 0.0613123, 0.313281, 0.179524, 0.891856, - 0.0671488, 0.313281, 0.197855, 0.892312, - 0.0732732, 0.313268, 0.216991, 0.892819, - 0.0797865, 0.313263, 0.236924, 0.893369, - 0.0865269, 0.313247, 0.257433, 0.894045, - 0.0931592, 0.313205, 0.278215, 0.894884, - 0.100532, 0.313276, 0.299467, 0.895832, - 0.107716, 0.313205, 0.322276, 0.897043, - 0.114099, 0.312873, 0.34642, 0.898515, - 0.119941, 0.312331, 0.371187, 0.900191, - 0.126044, 0.311731, 0.396656, 0.90188, - 0.131808, 0.310859, 0.422488, 0.904359, - 0.137289, 0.309857, 0.448744, 0.906923, - 0.142991, 0.308714, 0.475239, 0.910634, - 0.148253, 0.307465, 0.501983, 0.914502, - 0.153332, 0.305774, 0.529254, 0.919046, - 0.156646, 0.303156, 0.557709, 0.923194, - 0.159612, 0.299928, 0.586267, 0.928858, - 0.162027, 0.296245, 0.614925, 0.934464, - 0.164203, 0.291832, 0.643187, 0.939824, - 0.165602, 0.286565, 0.671601, 0.944582, - 0.165383, 0.280073, 0.700213, 0.949257, - 0.164439, 0.272891, 0.728432, 0.954389, - 0.162953, 0.264771, 0.756082, 0.958595, - 0.161007, 0.255927, 0.78369, 0.962138, - 0.157243, 0.245769, 0.810769, 0.966979, - 0.152872, 0.235127, 0.836999, 0.969566, - 0.148209, 0.22347, 0.862684, 0.972372, - 0.142211, 0.211147, 0.887847, 0.975916, - 0.135458, 0.198606, 0.911843, 0.978026, - 0.128398, 0.185498, 0.934795, 0.979686, - 0.120313, 0.17171, 0.956787, 0.980748, - 0.11166, 0.158159, 0.978046, 0.981622, - 0.103035, 0.144399, 0.997693, 0.982356, - 0.0930328, 0.13001, 1.01642, 0.983308, - 0.0834627, 0.115778, 1.03366, 0.985037, - 0.0732249, 0.101327, 1.05014, 0.986493, - 0.0628145, 0.086554, 1.06507, 0.988484, - 0.0526556, 0.0720413, 1.07907, 0.991051, - 0.0415744, 0.0571151, 1.09189, 0.993523, - 0.0314275, 0.0426643, 1.10369, 0.99628, - 0.0203603, 0.0279325, 1.11423, 0.998344, - 0.0102446, 0.0138182, 1.12421, 0.999997, 0.00042612, - 0.000193628, 1.1333, 0.871555, - 6.60007e-06, 0.329176, 1.74749e-05, 0.875255, - 0.000166579, 0.330571, 0.000441051, 0.875644, - 0.000666394, 0.330718, 0.00176441, 0.875159, - 0.00149903, 0.330536, 0.00396899, 0.87516, - 0.00266493, 0.330536, 0.007056, 0.875158, - 0.00416393, 0.330535, 0.0110251, 0.87516, - 0.00599598, 0.330535, 0.0158764, 0.875163, - 0.00816108, 0.330536, 0.0216101, 0.875174, - 0.0106591, 0.330538, 0.0282266, 0.875199, - 0.0134899, 0.330545, 0.0357266, 0.875257, - 0.0166538, 0.330563, 0.0441117, 0.875304, - 0.0201501, 0.330575, 0.0533821, 0.875373, - 0.0239785, 0.330595, 0.0635395, 0.875464, - 0.0281389, 0.330619, 0.0745872, 0.875565, - 0.0326301, 0.330645, 0.0865255, 0.875691, - 0.0374516, 0.330676, 0.0993599, 0.875897, - 0.0425993, 0.330733, 0.113093, 0.876091, - 0.0480576, 0.330776, 0.127722, 0.876353, - 0.0537216, 0.330826, 0.143227, 0.876649, - 0.0589807, 0.330809, 0.159462, 0.877034, - 0.0647865, 0.330819, 0.176642, 0.877443, - 0.0709789, 0.330817, 0.194702, 0.877956, - 0.0774782, 0.330832, 0.213577, 0.878499, - 0.0843175, 0.330822, 0.233246, 0.879144, - 0.0912714, 0.330804, 0.253512, 0.879982, - 0.0980824, 0.330766, 0.274137, 0.88097, - 0.105823, 0.330864, 0.295209, 0.882051, - 0.113671, 0.330896, 0.317226, 0.883397, - 0.120303, 0.330545, 0.341068, 0.884987, - 0.12667, 0.330068, 0.365613, 0.886789, - 0.133118, 0.329418, 0.390807, 0.889311, - 0.139024, 0.328683, 0.416494, 0.891995, - 0.144971, 0.327729, 0.442618, 0.895106, - 0.150747, 0.326521, 0.469131, 0.899527, - 0.156283, 0.325229, 0.495921, 0.90504, - 0.161707, 0.32378, 0.523162, 0.909875, - 0.165661, 0.32122, 0.55092, 0.91561, - 0.168755, 0.317942, 0.579928, 0.921225, - 0.171193, 0.313983, 0.608539, 0.927308, - 0.17319, 0.309636, 0.636854, 0.933077, - 0.174819, 0.304262, 0.66523, 0.938766, - 0.175002, 0.297563, 0.693609, 0.943667, - 0.173946, 0.289613, 0.722157, 0.949033, - 0.172221, 0.281227, 0.750021, 0.953765, - 0.169869, 0.271545, 0.777466, 0.95804, - 0.166578, 0.261034, 0.804853, 0.962302, - 0.161761, 0.249434, 0.831569, 0.966544, - 0.156636, 0.237484, 0.857779, 0.969372, - 0.150784, 0.224395, 0.883051, 0.972486, - 0.143672, 0.210786, 0.907864, 0.975853, - 0.135772, 0.196556, 0.931223, 0.977975, - 0.127942, 0.182307, 0.954061, 0.979122, - 0.118347, 0.167607, 0.97531, 0.980719, - 0.109112, 0.152739, 0.995666, 0.981223, - 0.0991789, 0.137932, 1.01475, 0.98216, - 0.0883553, 0.122692, 1.03253, 0.983379, - 0.0780825, 0.107493, 1.04917, 0.985434, - 0.0665646, 0.0917791, 1.06464, 0.987332, - 0.0557714, 0.0764949, 1.07896, 0.990004, - 0.0442805, 0.060721, 1.09199, 0.992975, - 0.0331676, 0.0452284, 1.10393, 0.995811, - 0.0219547, 0.0297934, 1.11476, 0.9982, - 0.0107613, 0.0146415, 1.12484, 1.00002, 0.000248678, - 0.00014555, 1.13413, 0.859519, - 6.93595e-06, 0.347264, 1.71673e-05, 0.859843, - 0.00017503, 0.347394, 0.000433219, 0.859656, - 0.000700076, 0.347319, 0.00173277, 0.859671, - 0.00157517, 0.347325, 0.00389875, 0.859669, - 0.00280028, 0.347324, 0.00693112, 0.85967, - 0.0043754, 0.347324, 0.01083, 0.859665, - 0.00630049, 0.347321, 0.0155954, 0.859685, - 0.0085755, 0.347328, 0.0212278, 0.859694, - 0.0112003, 0.347329, 0.0277273, 0.859718, - 0.0141747, 0.347336, 0.0350946, 0.85976, - 0.0174988, 0.347348, 0.0433314, 0.85982, - 0.0211722, 0.347366, 0.0524384, 0.859892, - 0.0251941, 0.347387, 0.0624168, 0.860006, - 0.0295649, 0.347422, 0.0732708, 0.860122, - 0.0342825, 0.347453, 0.0849999, 0.860282, - 0.0393462, 0.347499, 0.0976102, 0.860482, - 0.0447513, 0.347554, 0.111104, 0.860719, - 0.0504775, 0.347614, 0.125479, 0.860998, - 0.0563577, 0.347666, 0.140703, 0.861322, - 0.0619473, 0.347662, 0.156681, 0.861724, - 0.0681277, 0.347684, 0.173597, 0.862198, - 0.0746567, 0.347709, 0.191371, 0.862733, - 0.0815234, 0.347727, 0.209976, 0.863371, - 0.0886643, 0.347744, 0.229351, 0.86414, - 0.0957908, 0.347734, 0.24934, 0.865138, - 0.102912, 0.34772, 0.269797, 0.866182, - 0.110924, 0.3478, 0.290654, 0.867436, - 0.119223, 0.347911, 0.312074, 0.869087, - 0.126197, 0.347649, 0.335438, 0.870859, - 0.133145, 0.347222, 0.359732, 0.872997, - 0.139869, 0.346645, 0.38467, 0.875939, - 0.146089, 0.345935, 0.41019, 0.879012, - 0.152334, 0.345012, 0.436218, 0.883353, - 0.15821, 0.343924, 0.462641, 0.888362, - 0.164097, 0.342636, 0.489449, 0.895026, - 0.169528, 0.341351, 0.516629, 0.900753, - 0.174408, 0.339115, 0.544109, 0.906814, - 0.17751, 0.335809, 0.572857, 0.912855, - 0.180101, 0.331597, 0.601554, 0.919438, - 0.182116, 0.32698, 0.630198, 0.925962, - 0.183494, 0.321449, 0.658404, 0.931734, - 0.184159, 0.314595, 0.686625, 0.93762, - 0.18304, 0.306462, 0.71531, 0.943858, - 0.181323, 0.297514, 0.744272, 0.948662, - 0.178683, 0.287447, 0.771462, 0.953299, - 0.175379, 0.276166, 0.798593, 0.957346, - 0.170395, 0.263758, 0.8256, 0.962565, - 0.165042, 0.251019, 0.852575, 0.966075, - 0.158655, 0.237011, 0.878316, 0.969048, - 0.151707, 0.222518, 0.90329, 0.972423, - 0.143271, 0.207848, 0.927745, 0.975833, - 0.134824, 0.192463, 0.950859, 0.977629, - 0.125444, 0.1768, 0.972947, 0.978995, - 0.114949, 0.161033, 0.993263, 0.980533, - 0.104936, 0.145523, 1.01337, 0.980745, - 0.0935577, 0.129799, 1.03128, 0.981814, - 0.0822956, 0.113486, 1.04825, 0.983943, - 0.0710082, 0.0972925, 1.06405, 0.986141, - 0.0587931, 0.0808138, 1.0785, 0.988878, - 0.0472755, 0.0644915, 1.09204, 0.992132, - 0.0349128, 0.0478128, 1.10413, 0.9953, - 0.0232407, 0.031621, 1.11527, 0.998117, - 0.0112713, 0.0154935, 1.12551, 1.00003, 0.000339743, - 0.000195763, 1.13504, 0.845441, - 7.29126e-06, 0.364305, 1.69208e-05, 0.843588, - 0.000183164, 0.363506, 0.000425067, 0.843412, - 0.00073253, 0.36343, 0.00169999, 0.843401, - 0.00164818, 0.363426, 0.00382495, 0.843399, - 0.00293008, 0.363425, 0.00679993, 0.843401, - 0.00457822, 0.363425, 0.010625, 0.843394, - 0.00659249, 0.363421, 0.0153002, 0.843398, - 0.00897282, 0.363421, 0.0208258, 0.843415, - 0.0117191, 0.363426, 0.0272024, 0.843438, - 0.0148312, 0.363432, 0.0344305, 0.843483, - 0.018309, 0.363447, 0.0425116, 0.84356, - 0.0221521, 0.363472, 0.0514471, 0.843646, - 0.0263597, 0.363499, 0.061238, 0.843743, - 0.0309315, 0.363527, 0.0718873, 0.84388, - 0.0358658, 0.363569, 0.0833969, 0.844079, - 0.0411624, 0.363631, 0.0957742, 0.844279, - 0.0468128, 0.363688, 0.109015, 0.844549, - 0.0527923, 0.363761, 0.123124, 0.844858, - 0.0588204, 0.363817, 0.138044, 0.84522, - 0.0647573, 0.36383, 0.153755, 0.845669, - 0.0713181, 0.363879, 0.170394, 0.846155, - 0.0781697, 0.363908, 0.187861, 0.846789, - 0.0853913, 0.363969, 0.206176, 0.847502, - 0.0928086, 0.363999, 0.225244, 0.8484, - 0.10005, 0.363997, 0.244926, 0.849461, - 0.107615, 0.364008, 0.265188, 0.850562, - 0.115814, 0.364055, 0.28587, 0.851962, - 0.124334, 0.364179, 0.306926, 0.854326, - 0.131995, 0.364233, 0.329605, 0.856295, - 0.139338, 0.363856, 0.35359, 0.858857, - 0.146346, 0.363347, 0.37831, 0.862428, - 0.152994, 0.362807, 0.403722, 0.866203, - 0.159463, 0.361963, 0.429537, 0.871629, - 0.165623, 0.36112, 0.456, 0.877365, - 0.171649, 0.359917, 0.482773, 0.883744, - 0.177151, 0.35848, 0.509705, 0.890693, - 0.182381, 0.356523, 0.537215, 0.897278, - 0.186076, 0.3533, 0.565493, 0.903958, - 0.188602, 0.349095, 0.594293, 0.910908, - 0.190755, 0.344215, 0.623165, 0.918117, - 0.192063, 0.338606, 0.651573, 0.924644, - 0.192758, 0.331544, 0.679869, 0.931054, - 0.192238, 0.323163, 0.708668, 0.937303, - 0.190035, 0.313529, 0.737201, 0.943387, - 0.187162, 0.303152, 0.764977, 0.948494, - 0.183876, 0.29146, 0.792683, 0.952546, - 0.178901, 0.277917, 0.819228, 0.958077, - 0.173173, 0.264753, 0.846559, 0.962462, - 0.16645, 0.25002, 0.872962, 0.966569, - 0.159452, 0.234873, 0.898729, 0.969108, - 0.15074, 0.218752, 0.923126, 0.973072, - 0.141523, 0.202673, 0.947278, 0.975452, - 0.132075, 0.186326, 0.969938, 0.977784, - 0.121257, 0.169396, 0.991325, 0.97899, - 0.110182, 0.153044, 1.01123, 0.979777, - 0.0989634, 0.136485, 1.0299, 0.980865, - 0.0865894, 0.119343, 1.04727, 0.982432, - 0.0746115, 0.102452, 1.06341, 0.984935, - 0.0621822, 0.0852423, 1.07834, 0.987776, - 0.0495694, 0.0678546, 1.092, 0.99103, - 0.0372386, 0.0506917, 1.1043, 0.99474, - 0.0244353, 0.0333316, 1.11576, 0.997768, - 0.0121448, 0.0164348, 1.12617, 1.00003, 0.00031774, - 0.000169504, 1.13598, 0.825551, - 7.56799e-06, 0.378425, 1.65099e-05, 0.82664, - 0.000190922, 0.378923, 0.000416504, 0.826323, - 0.000763495, 0.378779, 0.0016656, 0.826359, - 0.00171789, 0.378795, 0.00374768, 0.82636, - 0.00305402, 0.378795, 0.00666259, 0.826368, - 0.00477185, 0.378798, 0.0104104, 0.826364, - 0.00687131, 0.378795, 0.0149912, 0.826368, - 0.00935232, 0.378795, 0.0204054, 0.826376, - 0.0122146, 0.378797, 0.0266532, 0.826399, - 0.0154581, 0.378803, 0.0337355, 0.82646, - 0.0190825, 0.378824, 0.0416537, 0.826525, - 0.0230873, 0.378846, 0.0504091, 0.826614, - 0.0274719, 0.378876, 0.0600032, 0.82674, - 0.0322355, 0.378917, 0.0704393, 0.826888, - 0.0373766, 0.378964, 0.0817195, 0.827078, - 0.0428936, 0.379024, 0.0938492, 0.827318, - 0.0487778, 0.379099, 0.106828, 0.82764, - 0.0549935, 0.379199, 0.120659, 0.827926, - 0.0611058, 0.379227, 0.13526, 0.828325, - 0.0675054, 0.379275, 0.150713, 0.828801, - 0.0743455, 0.379332, 0.167034, 0.8294, - 0.0815523, 0.379415, 0.184209, 0.830094, - 0.0890779, 0.379495, 0.202203, 0.8309, - 0.096736, 0.379555, 0.220945, 0.831943, - 0.104135, 0.379577, 0.240306, 0.833037, - 0.112106, 0.379604, 0.260317, 0.834278, - 0.120554, 0.379668, 0.2808, 0.836192, - 0.129128, 0.3799, 0.301654, 0.838671, - 0.137541, 0.380109, 0.323502, 0.840939, - 0.14523, 0.379809, 0.347176, 0.844575, - 0.15248, 0.379593, 0.371706, 0.848379, - 0.159607, 0.37909, 0.39688, 0.853616, - 0.166267, 0.378617, 0.422702, 0.858921, - 0.172698, 0.377746, 0.448919, 0.865324, - 0.178823, 0.376749, 0.475661, 0.872207, - 0.184542, 0.375363, 0.502599, 0.880018, - 0.189836, 0.373657, 0.529914, 0.88694, - 0.194294, 0.370673, 0.557683, 0.894779, - 0.197022, 0.36662, 0.586848, 0.902242, - 0.199108, 0.36138, 0.615831, 0.909914, - 0.200398, 0.355434, 0.644478, 0.917088, - 0.20094, 0.348173, 0.672905, 0.923888, - 0.200671, 0.339482, 0.701327, 0.930495, - 0.198773, 0.32956, 0.730101, 0.937247, - 0.195394, 0.318363, 0.758383, 0.943108, - 0.191956, 0.306323, 0.786539, 0.948296, - 0.187227, 0.292576, 0.813637, 0.953472, - 0.181165, 0.278234, 0.840793, 0.958485, - 0.174119, 0.263054, 0.867712, 0.962714, - 0.166564, 0.246756, 0.893635, 0.966185, - 0.158181, 0.229945, 0.919028, 0.970146, - 0.148275, 0.212633, 0.943413, 0.973491, - 0.138157, 0.195229, 0.966627, 0.975741, - 0.127574, 0.178048, 0.988817, 0.977238, - 0.11554, 0.160312, 1.00924, 0.978411, - 0.10364, 0.142857, 1.02845, 0.979811, - 0.0913122, 0.125317, 1.04648, 0.98116, - 0.0782558, 0.107627, 1.06284, 0.983543, - 0.0655957, 0.0895862, 1.07798, 0.986789, - 0.0520411, 0.0713756, 1.092, 0.990292, - 0.0389727, 0.053228, 1.10484, 0.994187, - 0.025808, 0.0351945, 1.11642, 0.997499, - 0.0126071, 0.0173198, 1.12703, 0.999999, 0.000275604, - 0.000148602, 1.13674, 0.81075, - 7.8735e-06, 0.394456, 1.61829e-05, 0.808692, - 0.000198293, 0.393453, 0.000407564, 0.80846, - 0.000792877, 0.39334, 0.00162965, 0.808595, - 0.00178416, 0.393407, 0.00366711, 0.808597, - 0.00317182, 0.393408, 0.00651934, 0.808598, - 0.00495589, 0.393408, 0.0101866, 0.808591, - 0.00713627, 0.393403, 0.0146689, 0.808592, - 0.00971285, 0.393402, 0.0199667, 0.80861, - 0.0126855, 0.393407, 0.0260803, 0.808633, - 0.0160538, 0.393413, 0.0330107, 0.80868, - 0.0198175, 0.393429, 0.0407589, 0.808748, - 0.0239758, 0.393453, 0.0493264, 0.808854, - 0.0285286, 0.39349, 0.0587161, 0.808992, - 0.0334748, 0.39354, 0.0689304, 0.809141, - 0.0388116, 0.393588, 0.0799707, 0.809352, - 0.0445375, 0.39366, 0.0918432, 0.809608, - 0.0506427, 0.393742, 0.104549, 0.809915, - 0.0570708, 0.393834, 0.118085, 0.810253, - 0.0633526, 0.393885, 0.132377, 0.810687, - 0.0700966, 0.393953, 0.147537, 0.811233, - 0.0772274, 0.394047, 0.163543, 0.811865, - 0.0847629, 0.394148, 0.180394, 0.812648, - 0.0925663, 0.394265, 0.198051, 0.813583, - 0.100416, 0.394363, 0.216443, 0.814683, - 0.108119, 0.394402, 0.235502, 0.815948, - 0.11644, 0.394489, 0.255242, 0.817278, - 0.125036, 0.394542, 0.275441, 0.819605, - 0.133655, 0.39486, 0.296094, 0.822256, - 0.142682, 0.395248, 0.317309, 0.825349, - 0.150756, 0.395241, 0.340516, 0.829605, - 0.158392, 0.395285, 0.364819, 0.83391, - 0.165801, 0.394922, 0.389736, 0.839808, - 0.172677, 0.394691, 0.415409, 0.845708, - 0.179448, 0.394006, 0.441546, 0.853025, - 0.185746, 0.393279, 0.46832, 0.859666, - 0.191684, 0.391655, 0.495302, 0.86789, - 0.197146, 0.390068, 0.52262, 0.875845, - 0.201904, 0.38727, 0.550336, 0.882634, - 0.205023, 0.382688, 0.578825, 0.891076, - 0.207098, 0.377543, 0.608103, 0.900589, - 0.208474, 0.371752, 0.63723, 0.90791, - 0.209068, 0.364016, 0.665769, 0.915971, - 0.208655, 0.355593, 0.694428, 0.923455, - 0.20729, 0.345439, 0.723224, 0.931514, - 0.203821, 0.334099, 0.751925, 0.937885, - 0.19986, 0.321069, 0.780249, 0.943136, - 0.194993, 0.306571, 0.8077, 0.948818, - 0.189132, 0.291556, 0.83497, 0.954433, - 0.181617, 0.275745, 0.86188, 0.959078, - 0.173595, 0.258695, 0.888562, 0.962705, - 0.164855, 0.240825, 0.914008, 0.966753, - 0.155129, 0.22268, 0.939145, 0.970704, - 0.144241, 0.204542, 0.963393, 0.973367, - 0.133188, 0.185927, 0.985983, 0.975984, - 0.121146, 0.167743, 1.00704, 0.976994, - 0.108366, 0.149218, 1.02715, 0.978485, - 0.0956746, 0.13131, 1.0455, 0.980074, - 0.0820733, 0.112513, 1.06221, 0.98225, - 0.0684061, 0.0938323, 1.07782, 0.98553, - 0.0549503, 0.0749508, 1.09199, 0.989529, - 0.0407857, 0.055848, 1.10508, 0.993536, - 0.0271978, 0.0368581, 1.11684, 0.997247, - 0.0132716, 0.0181845, 1.12789, 1, 0.000431817, - 0.000198809, 1.13792, 0.785886, - 8.12608e-06, 0.405036, 1.57669e-05, 0.790388, - 0.000205278, 0.407355, 0.000398297, 0.790145, - 0.000820824, 0.407231, 0.00159263, 0.790135, - 0.00184681, 0.407226, 0.00358336, 0.790119, - 0.00328316, 0.407218, 0.00637039, 0.790126, - 0.00512988, 0.40722, 0.0099539, 0.79013, - 0.00738684, 0.407221, 0.0143339, 0.790135, - 0.0100538, 0.407221, 0.0195107, 0.790134, - 0.0131306, 0.407217, 0.0254848, 0.79016, - 0.0166169, 0.407224, 0.0322572, 0.790197, - 0.020512, 0.407236, 0.0398284, 0.790273, - 0.0248157, 0.407263, 0.0482014, 0.790381, - 0.029527, 0.407304, 0.0573777, 0.790521, - 0.0346446, 0.407355, 0.0673602, 0.790704, - 0.0401665, 0.40742, 0.0781522, 0.790925, - 0.0460896, 0.407499, 0.0897582, 0.791195, - 0.0524017, 0.407589, 0.10218, 0.791522, - 0.0590121, 0.407691, 0.11541, 0.791878, - 0.0654876, 0.407748, 0.12939, 0.792361, - 0.0725207, 0.407849, 0.144237, 0.792942, - 0.0799844, 0.407963, 0.159924, 0.79362, - 0.0877896, 0.408087, 0.176425, 0.794529, - 0.0958451, 0.408259, 0.193733, 0.795521, - 0.103827, 0.408362, 0.211756, 0.796778, - 0.111937, 0.408482, 0.230524, 0.798027, - 0.120521, 0.408547, 0.249967, 0.799813, - 0.129242, 0.408721, 0.269926, 0.802387, - 0.138048, 0.409148, 0.290338, 0.805279, - 0.147301, 0.409641, 0.311193, 0.809251, - 0.155895, 0.410154, 0.333611, 0.813733, - 0.163942, 0.410297, 0.357615, 0.819081, - 0.171666, 0.410373, 0.382339, 0.825427, - 0.178905, 0.410348, 0.407828, 0.83172, - 0.185812, 0.409486, 0.434034, 0.83877, - 0.192318, 0.408776, 0.460493, 0.845817, - 0.198249, 0.407176, 0.487346, 0.854664, - 0.204034, 0.405719, 0.514832, 0.863495, - 0.208908, 0.403282, 0.542401, 0.871883, - 0.212765, 0.399293, 0.570683, 0.88065, - 0.214911, 0.393803, 0.599947, 0.89004, - 0.216214, 0.387536, 0.62932, 0.898476, - 0.216745, 0.379846, 0.658319, 0.906738, - 0.216387, 0.370625, 0.687138, 0.914844, - 0.215053, 0.360139, 0.71601, 0.923877, - 0.212007, 0.348849, 0.745124, 0.931925, - 0.207481, 0.335639, 0.773366, 0.938054, - 0.202418, 0.320798, 0.801636, 0.943895, - 0.196507, 0.304772, 0.829055, 0.949468, - 0.189009, 0.288033, 0.856097, 0.955152, - 0.180539, 0.270532, 0.88301, 0.959403, - 0.171437, 0.251639, 0.909296, 0.963309, - 0.161661, 0.232563, 0.934868, 0.967399, - 0.150425, 0.213231, 0.959662, 0.972009, - 0.138659, 0.194247, 0.98302, 0.97433, - 0.126595, 0.174718, 1.00517, 0.975823, - 0.113205, 0.155518, 1.02566, 0.976371, - 0.0996096, 0.136709, 1.04418, 0.978705, - 0.0860754, 0.117571, 1.06146, 0.981477, - 0.0714438, 0.0980046, 1.07777, 0.984263, - 0.0572304, 0.0782181, 1.09214, 0.988423, - 0.0428875, 0.0584052, 1.10553, 0.993, - 0.0282442, 0.038522, 1.11758, 0.99704, - 0.0140183, 0.0190148, 1.12864, 0.999913, 0.000369494, - 0.000145203, 1.13901, 0.777662, - 8.4153e-06, 0.423844, 1.54403e-05, 0.770458, - 0.000211714, 0.419915, 0.00038845, 0.770716, - 0.000846888, 0.420055, 0.00155386, 0.770982, - 0.00190567, 0.420202, 0.00349653, 0.770981, - 0.00338782, 0.420201, 0.00621606, 0.77098, - 0.00529338, 0.4202, 0.00971274, 0.770983, - 0.00762223, 0.4202, 0.0139867, 0.770985, - 0.0103741, 0.420198, 0.0190381, 0.770996, - 0.0135489, 0.4202, 0.0248677, 0.771029, - 0.0171461, 0.420212, 0.0314764, 0.771052, - 0.0211647, 0.420215, 0.0388648, 0.771131, - 0.0256048, 0.420245, 0.047036, 0.771235, - 0.0304647, 0.420284, 0.0559911, 0.771383, - 0.0357436, 0.420341, 0.0657346, 0.771591, - 0.0414392, 0.420423, 0.0762694, 0.771819, - 0.0475462, 0.420506, 0.0875984, 0.772123, - 0.0540506, 0.420617, 0.099727, 0.772464, - 0.060797, 0.42072, 0.112637, 0.772855, - 0.0675393, 0.420799, 0.126313, 0.773317, - 0.0748323, 0.420893, 0.140824, 0.773981, - 0.0825681, 0.421058, 0.15617, 0.774746, - 0.0906307, 0.421226, 0.172322, 0.77566, - 0.0988982, 0.421397, 0.189253, 0.776837, - 0.106994, 0.421569, 0.206912, 0.778097, - 0.115528, 0.421704, 0.225359, 0.779588, - 0.124317, 0.421849, 0.24447, 0.781574, - 0.133139, 0.422097, 0.264156, 0.784451, - 0.142179, 0.422615, 0.284318, 0.787682, - 0.15165, 0.423269, 0.304902, 0.792433, - 0.160771, 0.424396, 0.3265, 0.797359, - 0.169166, 0.424772, 0.35014, 0.803986, - 0.177149, 0.425475, 0.374768, 0.809504, - 0.184745, 0.424996, 0.399928, 0.815885, - 0.19173, 0.424247, 0.425796, 0.823513, - 0.198525, 0.423515, 0.452287, 0.832549, - 0.204709, 0.422787, 0.479321, 0.841653, - 0.210447, 0.421187, 0.506718, 0.850401, - 0.215501, 0.418519, 0.53432, 0.859854, - 0.219752, 0.414715, 0.56242, 0.869364, - 0.222305, 0.409462, 0.591558, 0.878837, - 0.223744, 0.402926, 0.621074, 0.888636, - 0.224065, 0.395043, 0.650538, 0.898132, - 0.223742, 0.38564, 0.679538, 0.907181, - 0.222308, 0.375378, 0.708674, 0.915621, - 0.219837, 0.363212, 0.737714, 0.9239, - 0.215233, 0.349313, 0.767014, 0.931644, - 0.209592, 0.334162, 0.795133, 0.938887, - 0.203644, 0.317943, 0.823228, 0.945282, - 0.196349, 0.300581, 0.850822, 0.950758, - 0.18742, 0.282195, 0.877594, 0.956146, - 0.177879, 0.262481, 0.904564, 0.960355, - 0.167643, 0.242487, 0.930741, 0.965256, - 0.156671, 0.222668, 0.955868, 0.968029, - 0.144123, 0.201907, 0.979869, 0.97251, - 0.131305, 0.18202, 1.00291, 0.974925, - 0.118335, 0.161909, 1.02392, 0.975402, - 0.103714, 0.142129, 1.0433, 0.976987, - 0.089415, 0.122447, 1.06089, 0.979677, - 0.0748858, 0.102248, 1.07713, 0.983184, - 0.0596086, 0.0814851, 1.09218, 0.987466, - 0.0447671, 0.0609484, 1.10585, 0.992348, - 0.0295217, 0.0401835, 1.11829, 0.996674, - 0.0143917, 0.0198163, 1.12966, 1.00003, 0.000321364, - 0.000149983, 1.1402, 0.757901, - 8.69074e-06, 0.436176, 1.51011e-05, 0.751195, - 0.000217848, 0.432317, 0.000378533, 0.751178, - 0.000871373, 0.432307, 0.0015141, 0.751195, - 0.00196061, 0.432317, 0.0034068, 0.751198, - 0.00348552, 0.432318, 0.00605659, 0.751195, - 0.00544599, 0.432315, 0.00946353, 0.751207, - 0.00784203, 0.43232, 0.013628, 0.751213, - 0.0106732, 0.43232, 0.0185499, 0.751221, - 0.0139393, 0.432319, 0.0242302, 0.751244, - 0.0176398, 0.432325, 0.0306694, 0.7513, - 0.0217743, 0.432348, 0.0378698, 0.751358, - 0.0263412, 0.432367, 0.0458321, 0.751458, - 0.0313396, 0.432404, 0.0545587, 0.751608, - 0.0367682, 0.432464, 0.0640543, 0.7518, - 0.0426246, 0.43254, 0.0743222, 0.752065, - 0.0489031, 0.432645, 0.0853668, 0.752376, - 0.0555828, 0.432762, 0.0971911, 0.752715, - 0.0623861, 0.432859, 0.109768, 0.753137, - 0.069415, 0.432958, 0.123126, 0.753676, - 0.0770039, 0.433099, 0.137308, 0.754345, - 0.084971, 0.433272, 0.15229, 0.755235, - 0.0932681, 0.433504, 0.168075, 0.756186, - 0.10171, 0.433693, 0.184625, 0.757363, - 0.110019, 0.433857, 0.201897, 0.75884, - 0.11887, 0.434102, 0.220014, 0.760467, - 0.127881, 0.434306, 0.238778, 0.762969, - 0.136766, 0.434751, 0.258172, 0.765823, - 0.14612, 0.43529, 0.278062, 0.769676, - 0.15566, 0.436236, 0.298437, 0.774909, - 0.165177, 0.437754, 0.319532, 0.77994, - 0.17402, 0.438343, 0.342505, 0.785757, - 0.182201, 0.438609, 0.366693, 0.792487, - 0.190104, 0.438762, 0.391668, 0.80038, - 0.197438, 0.438795, 0.417494, 0.808494, - 0.204365, 0.438226, 0.443933, 0.817695, - 0.210714, 0.437283, 0.470929, 0.828111, - 0.216651, 0.436087, 0.498569, 0.837901, - 0.221804, 0.433717, 0.526165, 0.847813, - 0.226318, 0.430133, 0.554155, 0.858314, - 0.229297, 0.425213, 0.582822, 0.868891, - 0.230999, 0.418576, 0.612847, 0.878941, - 0.231155, 0.410405, 0.642445, 0.888809, - 0.230935, 0.400544, 0.672024, 0.898089, - 0.229343, 0.389613, 0.701366, 0.908081, - 0.226886, 0.377197, 0.730763, 0.916819, - 0.222676, 0.363397, 0.759642, 0.924968, - 0.216835, 0.347437, 0.788775, 0.932906, - 0.210245, 0.32995, 0.817135, 0.940025, - 0.202992, 0.312262, 0.844912, 0.946101, - 0.19436, 0.293313, 0.872164, 0.952835, - 0.184125, 0.273638, 0.899443, 0.957347, - 0.173657, 0.252385, 0.926389, 0.961434, - 0.162204, 0.231038, 0.951947, 0.965522, - 0.14979, 0.209834, 0.976751, 0.969412, - 0.136307, 0.188821, 1.00022, 0.973902, - 0.122527, 0.168013, 1.02229, 0.974045, - 0.108213, 0.147634, 1.04199, 0.975775, - 0.0927397, 0.12705, 1.06019, 0.978383, - 0.0778212, 0.106309, 1.07711, 0.98211, - 0.0621216, 0.0849279, 1.09245, 0.986517, - 0.0463847, 0.0633519, 1.10651, 0.991696, - 0.0309353, 0.0419698, 1.11903, 0.996349, - 0.0150914, 0.0206272, 1.13073, 1.00003, 0.000442449, - 0.000231396, 1.14146, 0.727498, - 8.85074e-06, 0.441528, 1.45832e-05, 0.730897, - 0.000223525, 0.443589, 0.000368298, 0.730796, - 0.000893996, 0.443528, 0.00147303, 0.730805, - 0.00201149, 0.443533, 0.00331433, 0.730814, - 0.00357596, 0.443538, 0.00589222, 0.730815, - 0.00558734, 0.443538, 0.00920678, 0.730822, - 0.00804544, 0.44354, 0.0132582, 0.730836, - 0.0109501, 0.443545, 0.0180468, 0.730848, - 0.0143008, 0.443546, 0.0235732, 0.730871, - 0.0180969, 0.443552, 0.0298382, 0.730915, - 0.022338, 0.443567, 0.0368438, 0.730982, - 0.0270225, 0.443591, 0.044591, 0.731076, - 0.0321491, 0.443627, 0.0530831, 0.731245, - 0.0377166, 0.443699, 0.0623243, 0.73144, - 0.0437216, 0.443777, 0.0723181, 0.7317, - 0.0501576, 0.443881, 0.0830691, 0.732034, - 0.0569942, 0.444014, 0.0945809, 0.732388, - 0.0638756, 0.444113, 0.106825, 0.732853, - 0.071203, 0.444247, 0.119859, 0.733473, - 0.0790076, 0.444442, 0.13369, 0.734195, - 0.0871937, 0.444645, 0.148304, 0.735069, - 0.095696, 0.444877, 0.163702, 0.736169, - 0.10426, 0.445133, 0.179861, 0.73747, - 0.112853, 0.44537, 0.196778, 0.738991, - 0.12199, 0.445651, 0.214496, 0.740865, - 0.131153, 0.445958, 0.232913, 0.743637, - 0.140245, 0.446548, 0.251977, 0.746797, - 0.149722, 0.447246, 0.271551, 0.751517, - 0.159341, 0.448656, 0.291774, 0.756156, - 0.169106, 0.449866, 0.312455, 0.761519, - 0.178436, 0.450919, 0.334552, 0.768295, - 0.186904, 0.451776, 0.358491, 0.776613, - 0.195117, 0.452832, 0.383446, 0.783966, - 0.202695, 0.45249, 0.408945, 0.793542, - 0.20985, 0.452587, 0.435364, 0.803192, - 0.216403, 0.451852, 0.462336, 0.813892, - 0.22251, 0.450708, 0.48987, 0.824968, - 0.227676, 0.4486, 0.517697, 0.835859, - 0.232443, 0.445156, 0.545975, 0.846825, - 0.235775, 0.440351, 0.574483, 0.858085, - 0.237897, 0.433641, 0.604246, 0.868825, - 0.238074, 0.425354, 0.634101, 0.879638, - 0.237661, 0.415383, 0.664201, 0.889966, - 0.236186, 0.404136, 0.693918, 0.899479, - 0.233599, 0.390917, 0.723481, 0.908769, - 0.229737, 0.376352, 0.75258, 0.917966, - 0.223836, 0.360372, 0.781764, 0.926304, - 0.217067, 0.342551, 0.811139, 0.934626, - 0.209309, 0.324238, 0.839585, 0.941841, - 0.20071, 0.304484, 0.867044, 0.94789, - 0.190602, 0.283607, 0.894579, 0.954196, - 0.179253, 0.262205, 0.921743, 0.958383, - 0.167646, 0.239847, 0.948026, 0.963119, - 0.155073, 0.218078, 0.973296, 0.966941, - 0.141426, 0.195899, 0.998135, 0.970836, - 0.126849, 0.174121, 1.02021, 0.973301, - 0.112296, 0.153052, 1.04085, 0.97448, - 0.0964965, 0.131733, 1.05946, 0.977045, - 0.080489, 0.10997, 1.07693, 0.980751, - 0.064844, 0.0881657, 1.09254, 0.985475, - 0.0481938, 0.0657987, 1.10697, 0.991089, - 0.0319185, 0.0435215, 1.12004, 0.996122, - 0.0158088, 0.0214779, 1.13173, 1.00001, 0.000372455, - 0.000200295, 1.14291, 0.708622, - 9.07597e-06, 0.45304, 1.41962e-05, 0.711162, - 0.000228911, 0.454662, 0.000358052, 0.709812, - 0.000914446, 0.453797, 0.00143034, 0.709865, - 0.00205819, 0.453834, 0.00321935, 0.709864, - 0.00365894, 0.453833, 0.00572331, 0.709855, - 0.00571692, 0.453826, 0.00894278, 0.709862, - 0.00823201, 0.453828, 0.012878, 0.709875, - 0.011204, 0.453832, 0.0175295, 0.709896, - 0.0146323, 0.453839, 0.0228978, 0.709925, - 0.0185163, 0.453847, 0.0289839, 0.709974, - 0.0228551, 0.453866, 0.0357894, 0.710045, - 0.0276473, 0.453892, 0.0433161, 0.710133, - 0.032891, 0.453924, 0.0515665, 0.710292, - 0.0385851, 0.453992, 0.0605458, 0.710485, - 0.0447254, 0.45407, 0.0702574, 0.710769, - 0.0513051, 0.454192, 0.0807077, 0.711106, - 0.0582733, 0.454329, 0.091896, 0.711516, - 0.0652866, 0.45446, 0.103814, 0.712071, - 0.0728426, 0.454653, 0.116508, 0.712676, - 0.0808307, 0.45484, 0.129968, 0.713476, - 0.0892216, 0.455096, 0.144206, 0.714377, - 0.0979047, 0.455346, 0.159212, 0.715579, - 0.106531, 0.455647, 0.174973, 0.716977, - 0.115492, 0.455961, 0.191504, 0.71862, - 0.124821, 0.456315, 0.208835, 0.72084, - 0.134079, 0.4568, 0.226869, 0.723786, - 0.143427, 0.457521, 0.245582, 0.727464, - 0.153061, 0.458475, 0.264957, 0.732771, - 0.162768, 0.460239, 0.284948, 0.736515, - 0.172627, 0.460899, 0.30522, 0.743519, - 0.182487, 0.463225, 0.326717, 0.750041, - 0.191295, 0.464027, 0.350113, 0.758589, - 0.199746, 0.465227, 0.374782, 0.767703, - 0.207584, 0.465877, 0.400226, 0.777484, - 0.214973, 0.465996, 0.426442, 0.788792, - 0.221796, 0.466019, 0.453688, 0.800194, - 0.228038, 0.465083, 0.481246, 0.811234, - 0.233346, 0.462506, 0.509086, 0.822859, - 0.238073, 0.459257, 0.537338, 0.835082, - 0.241764, 0.454863, 0.566108, 0.846332, - 0.244241, 0.448163, 0.595126, 0.858355, - 0.244736, 0.439709, 0.625574, 0.87034, - 0.244278, 0.429837, 0.65617, 0.881027, - 0.24255, 0.418002, 0.686029, 0.891007, - 0.239912, 0.404325, 0.716039, 0.900874, - 0.236133, 0.389222, 0.745518, 0.911072, - 0.230672, 0.373269, 0.775026, 0.920359, - 0.22356, 0.355083, 0.804521, 0.928604, - 0.215591, 0.335533, 0.834045, 0.937175, - 0.206503, 0.315278, 0.861612, 0.942825, - 0.196684, 0.293653, 0.889131, 0.949805, - 0.185116, 0.271503, 0.916853, 0.955535, - 0.172703, 0.248821, 0.943541, 0.959843, - 0.159978, 0.225591, 0.970132, 0.964393, - 0.146375, 0.202719, 0.994709, 0.968008, - 0.131269, 0.179928, 1.0186, 0.971013, - 0.11569, 0.158007, 1.03928, 0.973334, - 0.1003, 0.13624, 1.05887, 0.975775, - 0.0833352, 0.1138, 1.07652, 0.979579, - 0.0668981, 0.0913141, 1.09297, 0.984323, - 0.0500902, 0.0683051, 1.10734, 0.990351, - 0.0332377, 0.0451771, 1.12084, 0.995823, - 0.0161491, 0.0221705, 1.13296, 1.0001, 0.000234083, - 0.000108712, 1.14441, 0.683895, - 9.24677e-06, 0.46015, 1.37429e-05, 0.68833, - 0.000233383, 0.463134, 0.000346865, 0.688368, - 0.000933547, 0.463159, 0.00138748, 0.688367, - 0.00210049, 0.463159, 0.00312187, 0.688369, - 0.00373415, 0.463159, 0.00555004, 0.688377, - 0.00583449, 0.463163, 0.00867216, 0.688386, - 0.00840128, 0.463166, 0.0124884, 0.688398, - 0.0114343, 0.463169, 0.0169993, 0.688418, - 0.0149329, 0.463175, 0.0222054, 0.688453, - 0.0188964, 0.463188, 0.028108, 0.688515, - 0.0233239, 0.463214, 0.0347085, 0.68857, - 0.0282136, 0.463231, 0.0420091, 0.688679, - 0.033564, 0.463276, 0.0500132, 0.688854, - 0.0393733, 0.463356, 0.0587255, 0.689038, - 0.0456354, 0.46343, 0.0681476, 0.689321, - 0.0523433, 0.463553, 0.0782897, 0.689662, - 0.059412, 0.463693, 0.0891501, 0.690188, - 0.0665736, 0.4639, 0.100735, 0.690755, - 0.0743106, 0.464107, 0.113074, 0.691405, - 0.0824722, 0.464329, 0.126161, 0.692198, - 0.0910484, 0.464585, 0.140007, 0.693196, - 0.0998778, 0.464893, 0.154612, 0.69454, - 0.108651, 0.465285, 0.169984, 0.695921, - 0.117855, 0.465596, 0.186106, 0.697749, - 0.12734, 0.466056, 0.203034, 0.700375, - 0.136714, 0.466771, 0.220703, 0.703395, - 0.146386, 0.467579, 0.239062, 0.707904, - 0.156096, 0.469067, 0.258188, 0.711673, - 0.165904, 0.469851, 0.277759, 0.717489, - 0.175812, 0.471815, 0.297935, 0.724051, - 0.185931, 0.47389, 0.318916, 0.731965, - 0.195238, 0.47587, 0.341591, 0.741151, - 0.204021, 0.477523, 0.366062, 0.751416, - 0.212113, 0.478881, 0.391396, 0.761848, - 0.21979, 0.479226, 0.417599, 0.771886, - 0.2267, 0.478495, 0.444401, 0.783998, - 0.232991, 0.477622, 0.472084, 0.796523, - 0.238645, 0.475833, 0.500193, 0.808851, - 0.243396, 0.472568, 0.52865, 0.821191, - 0.247226, 0.467857, 0.557362, 0.834261, - 0.250102, 0.461871, 0.586768, 0.846762, - 0.251056, 0.453543, 0.617085, 0.859867, - 0.250604, 0.443494, 0.647659, 0.871948, - 0.248783, 0.431711, 0.678119, 0.882967, - 0.245855, 0.417911, 0.708399, 0.892826, - 0.242168, 0.401993, 0.738256, 0.90332, - 0.237062, 0.385371, 0.767999, 0.913633, - 0.22997, 0.366837, 0.798191, 0.922774, - 0.221687, 0.346372, 0.827756, 0.931371, - 0.212345, 0.325682, 0.856425, 0.938929, - 0.20206, 0.303665, 0.884299, 0.944821, - 0.190981, 0.280786, 0.912023, 0.951792, - 0.178065, 0.2573, 0.939669, 0.957712, - 0.164634, 0.233448, 0.96655, 0.961912, - 0.150863, 0.209504, 0.992366, 0.966382, - 0.13577, 0.18597, 1.01633, 0.969588, - 0.119593, 0.162905, 1.03843, 0.971777, - 0.103203, 0.14053, 1.05841, 0.97433, - 0.0865888, 0.117909, 1.07632, 0.978686, - 0.0690829, 0.0944101, 1.09326, 0.983281, - 0.0516568, 0.0705671, 1.10796, 0.989562, - 0.034558, 0.0468592, 1.12182, 0.995465, - 0.0167808, 0.0229846, 1.1342, 0.999991, 0.000373016, - 0.000235606, 1.1459, 0.662251, - 9.39016e-06, 0.468575, 1.32714e-05, 0.666634, - 0.000237624, 0.471675, 0.000335842, 0.666411, - 0.000950385, 0.471516, 0.00134321, 0.666399, - 0.00213833, 0.471509, 0.00302221, 0.666386, - 0.0038014, 0.471499, 0.00537283, 0.666405, - 0.00593958, 0.471511, 0.00839533, 0.666406, - 0.00855253, 0.471508, 0.0120898, 0.666428, - 0.0116401, 0.471519, 0.0164569, 0.666444, - 0.0152015, 0.471522, 0.0214971, 0.66649, - 0.0192362, 0.471543, 0.027212, 0.666537, - 0.0237428, 0.471558, 0.033603, 0.666617, - 0.0287198, 0.471591, 0.0406728, 0.666718, - 0.0341647, 0.471631, 0.0484238, 0.666889, - 0.0400759, 0.47171, 0.0568621, 0.667104, - 0.0464479, 0.471805, 0.0659915, 0.667374, - 0.0532677, 0.471923, 0.0758178, 0.667772, - 0.0603805, 0.472098, 0.0863425, 0.668371, - 0.0677392, 0.472363, 0.0975917, 0.668971, - 0.0756028, 0.472596, 0.109567, 0.669696, - 0.0839293, 0.472869, 0.122272, 0.670481, - 0.0926683, 0.473126, 0.135718, 0.6715, - 0.1016, 0.473442, 0.149914, 0.672911, - 0.110566, 0.47389, 0.164882, 0.674512, - 0.119984, 0.474354, 0.180602, 0.67651, - 0.129574, 0.474922, 0.19711, 0.679292, - 0.139106, 0.475764, 0.214371, 0.682798, - 0.148993, 0.476886, 0.232405, 0.686955, - 0.158737, 0.478179, 0.251153, 0.691406, - 0.168754, 0.479432, 0.270436, 0.697438, - 0.178703, 0.481481, 0.290374, 0.704761, - 0.188955, 0.484143, 0.311044, 0.713599, - 0.198814, 0.487007, 0.333003, 0.723194, - 0.207869, 0.488962, 0.357144, 0.732601, - 0.216189, 0.489815, 0.382169, 0.744193, - 0.22398, 0.490888, 0.408227, 0.754907, - 0.231156, 0.490355, 0.434928, 0.767403, - 0.23747, 0.489548, 0.462599, 0.78107, - 0.243503, 0.488274, 0.490908, 0.793893, - 0.248114, 0.484843, 0.519421, 0.807296, - 0.25222, 0.4803, 0.548561, 0.820529, - 0.255265, 0.474097, 0.577772, 0.833716, - 0.256741, 0.466041, 0.607782, 0.848403, - 0.25637, 0.456547, 0.638807, 0.860755, - 0.254804, 0.443946, 0.670058, 0.874012, - 0.251834, 0.430852, 0.700749, 0.885619, - 0.247867, 0.414903, 0.731446, 0.896069, - 0.242634, 0.397276, 0.761191, 0.906266, - 0.236093, 0.378535, 0.791053, 0.916759, - 0.227543, 0.358038, 0.821298, 0.92523, - 0.21783, 0.335705, 0.850747, 0.93436, - 0.207534, 0.313797, 0.879258, 0.941631, - 0.195983, 0.289671, 0.907734, 0.947564, - 0.183567, 0.265319, 0.935206, 0.953681, - 0.169345, 0.240815, 0.962739, 0.960008, - 0.154909, 0.216119, 0.989227, 0.964145, - 0.140161, 0.192096, 1.01465, 0.968171, - 0.123411, 0.167855, 1.03737, 0.969859, - 0.106525, 0.144817, 1.05767, 0.972666, - 0.0891023, 0.12149, 1.0761, 0.977055, - 0.0718094, 0.0975306, 1.09336, 0.982527, - 0.0534213, 0.0730217, 1.10878, 0.989001, - 0.0355579, 0.0483366, 1.12285, 0.99512, - 0.0176383, 0.023938, 1.13548, 1.00007, 0.000368831, - 0.000211581, 1.14744, 0.651047, - 9.60845e-06, 0.484101, 1.2922e-05, 0.644145, - 0.000241347, 0.478968, 0.000324578, 0.64396, - 0.000965142, 0.478831, 0.00129798, 0.64396, - 0.00217154, 0.47883, 0.00292046, 0.643968, - 0.00386049, 0.478835, 0.00519202, 0.643974, - 0.00603186, 0.478838, 0.0081128, 0.643977, - 0.0086854, 0.478836, 0.011683, 0.643982, - 0.0118207, 0.478834, 0.0159031, 0.644024, - 0.0154374, 0.478856, 0.0207743, 0.644059, - 0.0195343, 0.478868, 0.0262975, 0.644122, - 0.0241103, 0.478896, 0.0324747, 0.644207, - 0.0291638, 0.478933, 0.039309, 0.64432, - 0.0346919, 0.478981, 0.0468029, 0.644481, - 0.0406919, 0.479053, 0.0549614, 0.644722, - 0.047159, 0.479169, 0.0637909, 0.645013, - 0.0540748, 0.479302, 0.0732974, 0.645503, - 0.0612001, 0.479541, 0.0834898, 0.646117, - 0.0687303, 0.479829, 0.0943873, 0.646707, - 0.0767846, 0.480061, 0.105991, 0.647431, - 0.0852465, 0.480343, 0.11831, 0.64831, - 0.0940719, 0.48066, 0.131348, 0.649486, - 0.103056, 0.481083, 0.14514, 0.650864, - 0.112261, 0.481528, 0.159676, 0.652604, - 0.121852, 0.482102, 0.174979, 0.654825, - 0.131505, 0.482813, 0.191079, 0.657876, - 0.141189, 0.483876, 0.207927, 0.661339, - 0.151239, 0.48499, 0.225586, 0.665463, - 0.161091, 0.486279, 0.243947, 0.670542, - 0.171235, 0.487968, 0.262957, 0.677361, - 0.181347, 0.49053, 0.282781, 0.685672, - 0.191679, 0.493862, 0.303311, 0.694551, - 0.201781, 0.49699, 0.324607, 0.703753, - 0.211164, 0.498884, 0.347916, 0.713703, - 0.219675, 0.500086, 0.372628, 0.725911, - 0.227836, 0.501554, 0.398694, 0.73862, - 0.23533, 0.502193, 0.425529, 0.752118, - 0.241786, 0.501811, 0.453209, 0.76579, - 0.247865, 0.500185, 0.481381, 0.779568, - 0.252696, 0.497159, 0.51011, 0.793991, - 0.256802, 0.492765, 0.539322, 0.808182, - 0.259942, 0.486827, 0.569078, 0.821698, - 0.261703, 0.478386, 0.598818, 0.836009, - 0.262006, 0.468772, 0.629762, 0.849824, - 0.260333, 0.456352, 0.661366, 0.863888, - 0.257398, 0.442533, 0.69295, 0.876585, - 0.253264, 0.426573, 0.723608, 0.888665, - 0.248026, 0.408964, 0.754378, 0.899537, - 0.241487, 0.389677, 0.784761, 0.9094, - 0.233463, 0.368516, 0.814688, 0.920166, - 0.223397, 0.346624, 0.845009, 0.928899, - 0.21255, 0.322717, 0.874431, 0.937156, - 0.200869, 0.298698, 0.902922, 0.943861, - 0.188387, 0.273491, 0.931356, 0.949557, - 0.174341, 0.247866, 0.958854, 0.955862, - 0.158994, 0.222496, 0.986098, 0.961721, - 0.143664, 0.197522, 1.01229, 0.965976, - 0.127412, 0.17302, 1.03571, 0.968652, - 0.109798, 0.148954, 1.05699, 0.971084, - 0.0916787, 0.125044, 1.07587, 0.975584, - 0.0739634, 0.100577, 1.09372, 0.98122, - 0.055322, 0.0753666, 1.10948, 0.988253, - 0.0366825, 0.0498899, 1.12394, 0.99482, - 0.0180389, 0.024611, 1.13694, 1.00001, 0.000229839, - 0.000188283, 1.14919, 0.613867, - 9.64198e-06, 0.479449, 1.23452e-05, 0.621485, - 0.000244534, 0.485399, 0.000313091, 0.621429, - 0.000978202, 0.485353, 0.00125245, 0.62112, - 0.00220004, 0.485114, 0.00281687, 0.621119, - 0.0039111, 0.485112, 0.00500783, 0.621122, - 0.00611091, 0.485112, 0.00782498, 0.621133, - 0.00879922, 0.485117, 0.0112687, 0.621152, - 0.0119756, 0.485125, 0.0153394, 0.621183, - 0.0156396, 0.485139, 0.0200382, 0.621227, - 0.0197898, 0.485158, 0.0253663, 0.621298, - 0.0244253, 0.485192, 0.0313261, 0.621388, - 0.0295441, 0.485233, 0.0379204, 0.621507, - 0.0351432, 0.485286, 0.0451523, 0.621693, - 0.0412198, 0.485378, 0.0530277, 0.621933, - 0.0477673, 0.485495, 0.0615522, 0.622232, - 0.0547574, 0.485635, 0.0707316, 0.622809, - 0.0619417, 0.485943, 0.0805883, 0.623407, - 0.069625, 0.486232, 0.0911267, 0.62406, - 0.077796, 0.486516, 0.102354, 0.624835, - 0.0863731, 0.486838, 0.114279, 0.625758, - 0.095251, 0.487188, 0.126902, 0.627043, - 0.104299, 0.487695, 0.140285, 0.628438, - 0.113724, 0.488163, 0.154397, 0.630325, - 0.123417, 0.488858, 0.169267, 0.632801, - 0.133137, 0.489754, 0.184941, 0.635784, - 0.143052, 0.490815, 0.20136, 0.639406, - 0.153132, 0.492048, 0.218643, 0.643872, - 0.163143, 0.49363, 0.236615, 0.6499, - 0.17333, 0.496009, 0.255449, 0.657201, - 0.183622, 0.498994, 0.275006, 0.666221, - 0.194019, 0.502888, 0.295354, 0.674419, - 0.204192, 0.505459, 0.316244, 0.683729, - 0.21406, 0.507771, 0.33849, 0.695584, - 0.222854, 0.510245, 0.363166, 0.708583, - 0.231315, 0.512293, 0.389071, 0.721233, - 0.238911, 0.512747, 0.415737, 0.735134, - 0.245657, 0.512482, 0.443331, 0.750179, - 0.251879, 0.511526, 0.471891, 0.765073, - 0.256911, 0.508935, 0.500892, 0.779794, - 0.261144, 0.504341, 0.530294, 0.794801, - 0.264316, 0.498515, 0.560144, 0.810339, - 0.266276, 0.491015, 0.590213, 0.824818, - 0.266981, 0.481126, 0.620865, 0.839375, - 0.265778, 0.468685, 0.652687, 0.853043, - 0.262748, 0.453925, 0.684759, 0.867335, - 0.258474, 0.437912, 0.716209, 0.88037, - 0.253187, 0.419648, 0.747508, 0.891711, - 0.246476, 0.39982, 0.77797, 0.902896, - 0.238735, 0.37879, 0.808586, 0.913601, - 0.22885, 0.355891, 0.838843, 0.923019, - 0.217656, 0.331773, 0.869014, 0.933432, - 0.205539, 0.307356, 0.898512, 0.939691, - 0.192595, 0.281321, 0.9269, 0.946938, - 0.178945, 0.255441, 0.955297, 0.952372, - 0.163587, 0.229013, 0.983231, 0.95909, - 0.147214, 0.203179, 1.00971, 0.963675, - 0.13064, 0.17792, 1.03438, 0.968247, - 0.113121, 0.152898, 1.05625, 0.97001, - 0.0945824, 0.128712, 1.07598, 0.974458, - 0.0755648, 0.103349, 1.094, 0.980168, - 0.0571998, 0.0776731, 1.1104, 0.987295, - 0.0377994, 0.0514445, 1.12491, 0.994432, - 0.0186417, 0.025429, 1.13851, 0.999975, 0.000542714, - 0.000282356, 1.15108, 0.592656, - 9.80249e-06, 0.486018, 1.19532e-05, 0.598467, - 0.000247275, 0.490781, 0.000301531, 0.597934, - 0.000988317, 0.490343, 0.00120517, 0.597903, - 0.00222366, 0.490319, 0.0027116, 0.597913, - 0.00395315, 0.490327, 0.00482077, 0.597919, - 0.00617653, 0.490329, 0.00753264, 0.597936, - 0.00889375, 0.490339, 0.0108478, 0.597956, - 0.0121043, 0.490347, 0.0147668, 0.597992, - 0.0158073, 0.490365, 0.0192905, 0.598032, - 0.0200017, 0.490382, 0.0244204, 0.598109, - 0.0246865, 0.49042, 0.0301593, 0.598215, - 0.0298594, 0.490474, 0.03651, 0.59833, - 0.0355167, 0.490524, 0.0434757, 0.598525, - 0.0416559, 0.490624, 0.0510629, 0.598778, - 0.0482692, 0.490753, 0.0592781, 0.599135, - 0.0553114, 0.49094, 0.0681304, 0.599802, - 0.062542, 0.491328, 0.0776467, 0.600361, - 0.0703638, 0.491598, 0.0878184, 0.60101, - 0.0786256, 0.491882, 0.0986573, 0.601811, - 0.0872962, 0.492232, 0.11018, 0.602861, - 0.0962284, 0.492684, 0.1224, 0.604167, - 0.10538, 0.493213, 0.135354, 0.605693, - 0.114896, 0.493799, 0.149034, 0.607682, - 0.124654, 0.494576, 0.163469, 0.610672, - 0.13456, 0.4959, 0.178747, 0.613313, - 0.144581, 0.496713, 0.194723, 0.617603, - 0.154703, 0.498499, 0.211617, 0.622174, - 0.16489, 0.500188, 0.229183, 0.628855, - 0.175164, 0.503072, 0.247786, 0.636963, - 0.185565, 0.506798, 0.267116, 0.644866, - 0.195911, 0.509719, 0.28702, 0.653741, - 0.206104, 0.512776, 0.307763, 0.664942, - 0.216447, 0.516812, 0.329631, 0.67633, - 0.22552, 0.519181, 0.353515, 0.690012, - 0.234316, 0.521681, 0.379226, 0.704243, - 0.242032, 0.523129, 0.405901, 0.719396, - 0.249172, 0.523768, 0.433585, 0.734471, - 0.255543, 0.522541, 0.462085, 0.750539, - 0.260697, 0.520217, 0.491233, 0.766365, - 0.26501, 0.516293, 0.521094, 0.781677, - 0.268409, 0.509708, 0.551014, 0.797132, - 0.270399, 0.501944, 0.581463, 0.812655, - 0.271247, 0.492025, 0.612402, 0.828592, - 0.270708, 0.480424, 0.643798, 0.844044, - 0.268085, 0.465955, 0.67682, 0.857305, - 0.263459, 0.448425, 0.708496, 0.87114, - 0.258151, 0.430243, 0.74046, 0.884936, - 0.251171, 0.410578, 0.771583, 0.895772, - 0.243305, 0.38862, 0.802234, 0.906961, - 0.234037, 0.365214, 0.833179, 0.917775, - 0.222714, 0.34116, 0.86353, 0.927883, - 0.210175, 0.31572, 0.893557, 0.936617, - 0.196925, 0.289159, 0.922976, 0.943384, - 0.182788, 0.261996, 0.951606, 0.949713, - 0.167965, 0.235324, 0.979958, 0.955818, - 0.151109, 0.208408, 1.00765, 0.961344, - 0.133834, 0.182591, 1.03329, 0.965469, - 0.115987, 0.156958, 1.0557, 0.968693, - 0.09746, 0.132239, 1.07583, 0.973165, - 0.0778514, 0.106195, 1.09451, 0.979387, - 0.0585067, 0.0797669, 1.11137, 0.98671, - 0.0390409, 0.0530263, 1.12643, 0.994093, - 0.019408, 0.0263163, 1.14016, 1.00002, 0.000540029, - 0.000194487, 1.15299, 0.574483, - 9.89066e-06, 0.494533, 1.14896e-05, 0.574478, - 0.000249127, 0.494528, 0.000289403, 0.574607, - 0.000996811, 0.494637, 0.00115797, 0.574396, - 0.00224241, 0.494458, 0.00260498, 0.574377, - 0.00398632, 0.49444, 0.00463102, 0.574386, - 0.00622836, 0.494445, 0.00723623, 0.574401, - 0.0089683, 0.494453, 0.010421, 0.574419, - 0.0122056, 0.49446, 0.0141859, 0.574459, - 0.0159396, 0.494481, 0.0185322, 0.574525, - 0.0201692, 0.49452, 0.0234617, 0.574587, - 0.0248924, 0.494547, 0.0289762, 0.574697, - 0.0301074, 0.494604, 0.0350797, 0.574853, - 0.0358114, 0.494688, 0.0417767, 0.575027, - 0.041999, 0.494772, 0.0490718, 0.575294, - 0.0486618, 0.494915, 0.0569728, 0.575733, - 0.0557148, 0.495173, 0.0654955, 0.576356, - 0.0630489, 0.495537, 0.0746612, 0.576944, - 0.0709285, 0.495836, 0.0844615, 0.57765, - 0.0792723, 0.496177, 0.0949142, 0.578491, - 0.0880167, 0.496563, 0.10603, 0.579639, - 0.0969462, 0.497096, 0.117841, 0.580989, - 0.10622, 0.497684, 0.130367, 0.582587, - 0.115861, 0.498337, 0.143609, 0.584951, - 0.125605, 0.499414, 0.157625, 0.587602, - 0.135608, 0.500518, 0.172413, 0.59076, - 0.145742, 0.501767, 0.187999, 0.594992, - 0.155934, 0.503542, 0.20445, 0.600656, - 0.166303, 0.506135, 0.221764, 0.607816, - 0.176681, 0.509542, 0.24002, 0.61522, - 0.187071, 0.51263, 0.258992, 0.623702, - 0.197465, 0.516021, 0.278773, 0.634192, - 0.207816, 0.520422, 0.299377, 0.644936, - 0.218183, 0.524073, 0.320802, 0.657888, - 0.2278, 0.528049, 0.34384, 0.670666, - 0.236747, 0.52986, 0.36916, 0.685626, - 0.24484, 0.531892, 0.395867, 0.701304, - 0.252071, 0.532727, 0.423488, 0.717727, - 0.258714, 0.532146, 0.452201, 0.733914, - 0.264211, 0.529883, 0.481579, 0.750529, - 0.26859, 0.5259, 0.511558, 0.76747, - 0.272046, 0.51999, 0.542042, 0.785189, - 0.274225, 0.513083, 0.572799, 0.800954, - 0.275189, 0.502936, 0.603816, 0.816962, - 0.274946, 0.490921, 0.635461, 0.83336, - 0.272695, 0.47684, 0.6676, 0.848143, - 0.268223, 0.459405, 0.70051, 0.861818, - 0.262768, 0.440319, 0.732902, 0.876828, - 0.255872, 0.420123, 0.765084, 0.889312, - 0.247703, 0.398379, 0.796391, 0.900412, - 0.238381, 0.374496, 0.827333, 0.912251, - 0.227783, 0.349874, 0.858385, 0.921792, - 0.214832, 0.323181, 0.888652, 0.931273, - 0.200949, 0.296624, 0.917763, 0.940295, - 0.186537, 0.269211, 0.947878, 0.946812, - 0.171538, 0.241447, 0.977016, 0.953588, - 0.155254, 0.213829, 1.00501, 0.958841, - 0.137156, 0.186807, 1.03179, 0.963746, - 0.118699, 0.160706, 1.05502, 0.966468, - 0.0998358, 0.135504, 1.07568, 0.971178, - 0.0805186, 0.109131, 1.09479, 0.97831, - 0.0599348, 0.0818293, 1.1123, 0.985886, - 0.0399661, 0.0545872, 1.12771, 0.994021, - 0.0198682, 0.0269405, 1.14186, 1.00009, 0.000271022, - 0.00012989, 1.15514, 0.538716, - 9.90918e-06, 0.486732, 1.09675e-05, 0.550656, - 0.000250642, 0.497518, 0.000277412, 0.55057, - 0.00100265, 0.497441, 0.00110974, 0.550903, - 0.00225672, 0.497733, 0.00249779, 0.550568, - 0.00401046, 0.497438, 0.00443906, 0.550574, - 0.00626613, 0.49744, 0.00693637, 0.550591, - 0.0090226, 0.497449, 0.00998921, 0.550623, - 0.0122795, 0.497469, 0.0135984, 0.550667, - 0.0160361, 0.497495, 0.0177654, 0.550724, - 0.0202908, 0.497526, 0.0224915, 0.550792, - 0.0250421, 0.497557, 0.0277795, 0.550918, - 0.0302878, 0.49763, 0.0336334, 0.551058, - 0.0360241, 0.497701, 0.0400573, 0.551276, - 0.0422473, 0.497824, 0.0470585, 0.551551, - 0.0489441, 0.497977, 0.0546433, 0.552074, - 0.0559596, 0.498312, 0.0628367, 0.552681, - 0.0633978, 0.498679, 0.071646, 0.553324, - 0.0713176, 0.499031, 0.0810746, 0.554011, - 0.0797268, 0.499365, 0.091129, 0.55488, - 0.0885238, 0.499779, 0.101837, 0.556171, - 0.0974417, 0.500444, 0.113239, 0.557498, - 0.106841, 0.501025, 0.125316, 0.559299, - 0.116533, 0.501864, 0.138128, 0.561647, - 0.126298, 0.502967, 0.151695, 0.564347, - 0.136388, 0.504129, 0.16604, 0.567863, - 0.146576, 0.505713, 0.181207, 0.572569, - 0.156832, 0.507953, 0.197259, 0.578919, - 0.167323, 0.511186, 0.214258, 0.585387, - 0.177712, 0.514042, 0.232038, 0.593134, - 0.188184, 0.517484, 0.250733, 0.603295, - 0.198717, 0.522345, 0.270454, 0.613854, - 0.209177, 0.526751, 0.290807, 0.626092, - 0.219644, 0.531595, 0.312202, 0.637868, - 0.229494, 0.534721, 0.334435, 0.652458, - 0.238718, 0.538304, 0.359184, 0.666985, - 0.247061, 0.539875, 0.385637, 0.683301, - 0.254652, 0.541042, 0.41328, 0.69998, - 0.261376, 0.540735, 0.441903, 0.717824, - 0.267085, 0.539139, 0.471609, 0.734617, - 0.271465, 0.534958, 0.501446, 0.753663, - 0.27528, 0.53032, 0.532571, 0.770512, - 0.277617, 0.522134, 0.563641, 0.787356, - 0.278525, 0.51206, 0.595067, 0.806252, - 0.278512, 0.50119, 0.627226, 0.822061, - 0.277023, 0.486791, 0.659402, 0.838959, - 0.273175, 0.470467, 0.692874, 0.85379, - 0.267238, 0.450688, 0.725702, 0.868268, - 0.260327, 0.429741, 0.75832, 0.881994, - 0.251946, 0.407223, 0.790189, 0.893885, - 0.242432, 0.383214, 0.821625, 0.905118, - 0.231904, 0.357297, 0.853011, 0.916045, - 0.219545, 0.330733, 0.883773, 0.927614, - 0.205378, 0.303916, 0.914435, 0.936005, - 0.190388, 0.275941, 0.944502, 0.944533, - 0.1749, 0.247493, 0.974439, 0.950758, - 0.158588, 0.218996, 1.00286, 0.957078, - 0.141027, 0.191559, 1.0304, 0.962448, - 0.121507, 0.164457, 1.05466, 0.964993, - 0.102068, 0.138636, 1.0761, 0.970017, - 0.0822598, 0.111861, 1.09541, 0.97661, - 0.062033, 0.0843438, 1.11317, 0.985073, - 0.0409832, 0.0558496, 1.12911, 0.993515, - 0.020146, 0.0275331, 1.1438, 1.00006, 0.00027329, - 0.000107883, 1.15736, 0.525324, - 9.99341e-06, 0.498153, 1.05385e-05, 0.526513, - 0.000251605, 0.499277, 0.000265329, 0.526517, - 0.00100641, 0.499282, 0.0010613, 0.526588, - 0.00226466, 0.499337, 0.00238823, 0.526539, - 0.0040255, 0.499302, 0.00424535, 0.526547, - 0.00628954, 0.499306, 0.00663364, 0.526561, - 0.00905628, 0.499313, 0.00955337, 0.526593, - 0.0123253, 0.499334, 0.0130054, 0.526642, - 0.0160957, 0.499365, 0.0169911, 0.5267, - 0.0203661, 0.499396, 0.0215122, 0.526792, - 0.0251347, 0.499451, 0.0265718, 0.526904, - 0.0303985, 0.499511, 0.0321732, 0.527079, - 0.0361554, 0.499617, 0.0383231, 0.527285, - 0.0423982, 0.499731, 0.045026, 0.527602, - 0.0491121, 0.499924, 0.0522936, 0.528166, - 0.0561127, 0.500306, 0.0601528, 0.52879, - 0.0635988, 0.5007, 0.0686059, 0.529421, - 0.071581, 0.501048, 0.0776518, 0.530144, - 0.0799854, 0.501421, 0.0873148, 0.531062, - 0.0888032, 0.501884, 0.0976084, 0.532374, - 0.0977643, 0.50259, 0.108588, 0.533828, - 0.107197, 0.50329, 0.120234, 0.53581, - 0.116887, 0.504312, 0.132602, 0.538063, - 0.126755, 0.505365, 0.145721, 0.5409, - 0.136819, 0.506668, 0.159617, 0.544882, - 0.147117, 0.508731, 0.174369, 0.550238, - 0.157446, 0.511601, 0.190028, 0.556038, - 0.167988, 0.514431, 0.206587, 0.563031, - 0.178364, 0.517808, 0.224046, 0.571543, - 0.189007, 0.521937, 0.242503, 0.582255, - 0.199546, 0.527415, 0.261977, 0.59272, - 0.210084, 0.531682, 0.282162, 0.605648, - 0.220448, 0.537123, 0.303426, 0.61785, - 0.230593, 0.540664, 0.325323, 0.632223, - 0.240238, 0.544467, 0.348993, 0.648819, - 0.24887, 0.547594, 0.375462, 0.665825, - 0.256657, 0.54912, 0.403024, 0.683389, - 0.263711, 0.549294, 0.431773, 0.701495, - 0.269666, 0.547649, 0.461494, 0.719197, - 0.274169, 0.543786, 0.491623, 0.737906, - 0.278124, 0.538644, 0.522994, 0.756652, - 0.280632, 0.531057, 0.554775, 0.775279, - 0.281741, 0.521972, 0.586441, 0.792688, - 0.281652, 0.509613, 0.618596, 0.811894, - 0.280345, 0.496497, 0.651462, 0.827938, - 0.277128, 0.47968, 0.684023, 0.844837, - 0.271646, 0.460688, 0.718024, 0.859239, - 0.264397, 0.438872, 0.751207, 0.874088, - 0.256144, 0.41577, 0.784232, 0.887693, - 0.246311, 0.391369, 0.816191, 0.899402, - 0.235497, 0.365872, 0.847828, 0.910973, - 0.223631, 0.338618, 0.87934, 0.92204, - 0.209874, 0.310803, 0.910325, 0.930987, - 0.194265, 0.281802, 0.940695, 0.94, - 0.178125, 0.252836, 0.970958, 0.948018, - 0.161479, 0.224239, 1.00078, 0.955141, - 0.144038, 0.195857, 1.0288, 0.960513, - 0.124915, 0.168487, 1.05371, 0.963964, - 0.104284, 0.141495, 1.07596, 0.968713, - 0.0838732, 0.114437, 1.09628, 0.975524, - 0.0635579, 0.0863105, 1.11448, 0.98431, - 0.042291, 0.0574774, 1.13069, 0.992916, - 0.0209131, 0.0284343, 1.14568, 0.999926, 0.000743097, - 0.000379265, 1.15955, 0.501042, - 9.98428e-06, 0.498726, 1.00306e-05, 0.502992, - 0.000252112, 0.500665, 0.000253283, 0.502417, - 0.00100791, 0.500092, 0.00101259, 0.502965, - 0.00226919, 0.500621, 0.00227978, 0.502318, - 0.00403109, 0.499994, 0.00405011, 0.502333, - 0.00629832, 0.500005, 0.00632868, 0.502362, - 0.00906907, 0.500027, 0.00911446, 0.502369, - 0.0123423, 0.500023, 0.0124078, 0.50243, - 0.0161178, 0.500066, 0.016211, 0.502493, - 0.0203937, 0.500103, 0.0205256, 0.502592, - 0.0251684, 0.500166, 0.0253548, 0.502707, - 0.0304389, 0.50023, 0.0307029, 0.502881, - 0.0362015, 0.500335, 0.0365753, 0.503124, - 0.0424507, 0.500488, 0.0429798, 0.503443, - 0.0491582, 0.500686, 0.0499268, 0.504083, - 0.0561476, 0.501155, 0.0574541, 0.504668, - 0.0636846, 0.501524, 0.0655408, 0.505319, - 0.0716834, 0.501904, 0.0742072, 0.50609, - 0.0800925, 0.502321, 0.0834699, 0.507122, - 0.0888425, 0.502896, 0.0933603, 0.508414, - 0.097855, 0.503603, 0.10391, 0.509955, - 0.107304, 0.504416, 0.115113, 0.512061, - 0.116921, 0.505565, 0.127054, 0.514419, - 0.12689, 0.506732, 0.139709, 0.517529, - 0.136934, 0.508338, 0.153173, 0.522085, - 0.147327, 0.510987, 0.167528, 0.526986, - 0.157612, 0.513527, 0.182708, 0.533122, - 0.168213, 0.516717, 0.198881, 0.540807, - 0.178688, 0.520832, 0.215986, 0.550687, - 0.189511, 0.52632, 0.234335, 0.560567, - 0.199998, 0.531009, 0.253375, 0.571698, - 0.210652, 0.535839, 0.273499, 0.584364, - 0.220917, 0.541091, 0.294355, 0.599066, - 0.23137, 0.546875, 0.316525, 0.614148, - 0.241206, 0.551306, 0.339671, 0.631157, - 0.250379, 0.555187, 0.36531, 0.647919, - 0.258397, 0.556595, 0.392767, 0.666112, - 0.265528, 0.556949, 0.421397, 0.686158, - 0.271827, 0.556617, 0.451433, 0.704838, - 0.27674, 0.552975, 0.482131, 0.723957, - 0.280733, 0.547814, 0.513458, 0.74262, - 0.283359, 0.53997, 0.545446, 0.762009, - 0.284541, 0.530422, 0.57775, 0.781314, - 0.284507, 0.518546, 0.610434, 0.799116, - 0.283309, 0.504178, 0.643178, 0.817604, - 0.280378, 0.48843, 0.676248, 0.83459, - 0.275619, 0.469457, 0.709698, 0.850974, - 0.26856, 0.447698, 0.744245, 0.866747, - 0.260094, 0.424791, 0.777695, 0.881412, - 0.249929, 0.399913, 0.810392, 0.8936, - 0.239137, 0.37308, 0.842872, 0.905943, - 0.226818, 0.345705, 0.874677, 0.916408, - 0.213699, 0.31706, 0.906257, 0.927215, - 0.198428, 0.288444, 0.936881, 0.935625, - 0.181643, 0.258329, 0.96795, 0.944076, - 0.164386, 0.228488, 0.998216, 0.951229, - 0.146339, 0.199763, 1.02689, 0.958793, - 0.127709, 0.172153, 1.0535, 0.963219, - 0.107244, 0.144989, 1.07646, 0.967562, - 0.0857764, 0.11685, 1.09675, 0.974866, - 0.0645377, 0.0880571, 1.11576, 0.983353, - 0.0431732, 0.0587352, 1.13227, 0.992503, - 0.0218356, 0.0294181, 1.1478, 1.00003, 0.000605203, - 0.000231013, 1.16207, 0.482935, - 1.01177e-05, 0.504695, 9.68142e-06, 0.477554, - 0.000251521, 0.499071, 0.000240676, 0.477904, - 0.00100683, 0.499436, 0.00096342, 0.478368, - 0.00226636, 0.499899, 0.0021687, 0.477977, - 0.00402719, 0.499513, 0.00385384, 0.477993, - 0.00629226, 0.499525, 0.0060221, 0.478011, - 0.00906011, 0.499536, 0.00867289, 0.478051, - 0.0123305, 0.499566, 0.0118074, 0.478089, - 0.016102, 0.499587, 0.0154269, 0.478171, - 0.0203736, 0.499645, 0.0195341, 0.478254, - 0.025143, 0.499692, 0.0241318, 0.47839, - 0.0304071, 0.499779, 0.0292247, 0.478588, - 0.0361631, 0.499911, 0.0348196, 0.478812, - 0.0424023, 0.500046, 0.0409231, 0.479208, - 0.0490724, 0.500326, 0.047552, 0.479841, - 0.0560722, 0.500805, 0.0547377, 0.480392, - 0.0636125, 0.501152, 0.0624607, 0.481068, - 0.0716134, 0.501561, 0.0707473, 0.481898, - 0.0800062, 0.502054, 0.0796118, 0.483022, - 0.0886568, 0.502728, 0.0890974, 0.484332, - 0.0977553, 0.503479, 0.0992099, 0.486126, - 0.107173, 0.504546, 0.10999, 0.488066, - 0.11677, 0.50557, 0.121476, 0.490521, - 0.126725, 0.506849, 0.133672, 0.494232, - 0.136793, 0.50911, 0.146731, 0.498302, - 0.147116, 0.511345, 0.160577, 0.503565, - 0.157446, 0.514344, 0.175335, 0.510902, - 0.168121, 0.518824, 0.191207, 0.519263, - 0.178799, 0.523666, 0.208058, 0.528204, - 0.189407, 0.528296, 0.225875, 0.538854, - 0.200145, 0.533724, 0.244782, 0.551278, - 0.210701, 0.539833, 0.264753, 0.565222, - 0.221303, 0.546131, 0.285745, 0.579403, - 0.231688, 0.551496, 0.307592, 0.595469, - 0.241718, 0.556809, 0.330582, 0.610929, - 0.250992, 0.559641, 0.354995, 0.629433, - 0.259602, 0.562379, 0.382471, 0.648504, - 0.267038, 0.563676, 0.411126, 0.66756, - 0.273388, 0.562092, 0.440924, 0.689143, - 0.278788, 0.560807, 0.472118, 0.709056, - 0.282783, 0.555701, 0.503774, 0.729855, - 0.285836, 0.548698, 0.536364, 0.748954, - 0.287078, 0.538544, 0.56895, 0.768373, - 0.287133, 0.526711, 0.601991, 0.78827, - 0.285839, 0.512511, 0.635403, 0.807465, - 0.283238, 0.496323, 0.668797, 0.825194, - 0.27906, 0.477638, 0.702584, 0.842203, - 0.272286, 0.456253, 0.736393, 0.857749, - 0.263854, 0.432412, 0.77096, 0.874799, - 0.253943, 0.407806, 0.80489, 0.887497, - 0.24237, 0.38033, 0.83771, 0.89966, - 0.230278, 0.352446, 0.870376, 0.911753, - 0.21646, 0.323268, 0.902256, 0.923011, - 0.202071, 0.294314, 0.933306, 0.932375, - 0.185519, 0.264104, 0.965177, 0.940537, - 0.167604, 0.234035, 0.996303, 0.948904, - 0.149068, 0.20412, 1.0261, 0.955263, - 0.129539, 0.175431, 1.05304, 0.960303, - 0.109932, 0.148116, 1.07617, 0.965512, - 0.0880572, 0.119693, 1.09742, 0.973466, - 0.0660548, 0.0901619, 1.11721, 0.98284, - 0.0439228, 0.0599875, 1.13436, 0.992216, - 0.0219588, 0.0298975, 1.15006, 0.999946, 0.000119402, - 2.08547e-05, 1.16471, 0.447827, - 1.00414e-05, 0.491543, 9.14833e-06, 0.454778, - 0.000251257, 0.499172, 0.00022891, 0.453519, - 0.00100342, 0.497787, 0.000914184, 0.45357, - 0.00225776, 0.497847, 0.00205701, 0.453578, - 0.00401371, 0.497855, 0.00365705, 0.45357, - 0.00627107, 0.497841, 0.00571453, 0.453598, - 0.00902968, 0.497864, 0.00823019, 0.453627, - 0.0122888, 0.497882, 0.0112049, 0.453684, - 0.0160475, 0.497923, 0.0146405, 0.453764, - 0.0203044, 0.49798, 0.0185394, 0.453866, - 0.0250576, 0.498049, 0.0229054, 0.453996, - 0.0303028, 0.49813, 0.0277424, 0.454196, - 0.0360379, 0.498267, 0.0330587, 0.454457, - 0.0422521, 0.498445, 0.0388613, 0.454926, - 0.0488393, 0.498812, 0.0451767, 0.455525, - 0.0558653, 0.499272, 0.0520153, 0.456074, - 0.0633772, 0.499625, 0.0593754, 0.456752, - 0.0713606, 0.500049, 0.0672751, 0.457648, - 0.07971, 0.500615, 0.0757447, 0.458849, - 0.0883032, 0.501399, 0.0848231, 0.46029, - 0.0974095, 0.502293, 0.0945135, 0.462, - 0.106729, 0.503301, 0.104848, 0.464121, - 0.116354, 0.504533, 0.115884, 0.466889, - 0.126214, 0.506172, 0.127652, 0.470744, - 0.136324, 0.508667, 0.14024, 0.47488, - 0.146595, 0.510995, 0.153673, 0.480845, - 0.157027, 0.514832, 0.168053, 0.488262, - 0.167658, 0.519506, 0.183508, 0.496547, - 0.178343, 0.524347, 0.199948, 0.506254, - 0.188916, 0.52983, 0.217503, 0.517961, - 0.199975, 0.536357, 0.236272, 0.531484, - 0.210624, 0.543641, 0.256096, 0.545496, - 0.221227, 0.550048, 0.277085, 0.559497, - 0.231568, 0.555076, 0.298615, 0.575752, - 0.241698, 0.560541, 0.321547, 0.591999, - 0.251172, 0.564156, 0.345602, 0.610654, - 0.260178, 0.567607, 0.371851, 0.630484, - 0.268094, 0.56923, 0.40076, 0.651807, - 0.274661, 0.569779, 0.430801, 0.67239, - 0.280331, 0.566791, 0.461939, 0.693024, - 0.284501, 0.562007, 0.493854, 0.715473, - 0.287852, 0.555791, 0.526992, 0.736323, - 0.28929, 0.546345, 0.560102, 0.755771, - 0.289405, 0.534, 0.593543, 0.775424, - 0.2881, 0.519114, 0.627256, 0.795447, - 0.285562, 0.502543, 0.661464, 0.815319, - 0.281416, 0.484773, 0.695206, 0.831769, - 0.275523, 0.463445, 0.729044, 0.849464, - 0.267516, 0.440269, 0.764069, 0.866775, - 0.257584, 0.415049, 0.799089, 0.881252, - 0.245817, 0.388049, 0.831948, 0.894209, - 0.233127, 0.35889, 0.865526, 0.906922, - 0.219579, 0.329915, 0.89818, 0.919686, - 0.204491, 0.300441, 0.930013, 0.929044, - 0.188962, 0.269445, 0.962061, 0.938393, - 0.171079, 0.238402, 0.994214, 0.94661, - 0.15199, 0.208204, 1.02533, 0.953095, - 0.131953, 0.178653, 1.0529, 0.958644, - 0.111233, 0.150684, 1.0771, 0.963925, - 0.0903098, 0.122359, 1.09855, 0.971995, - 0.0680505, 0.0923342, 1.11874, 0.981658, - 0.0448512, 0.0614195, 1.13635, 0.991649, - 0.0221931, 0.0303582, 1.15238, 0.999985, 0.000393403, - 0.000111086, 1.16772, 0.396806, - 9.71563e-06, 0.457671, 8.42355e-06, 0.429186, - 0.000249421, 0.495017, 0.00021625, 0.429324, - 0.000998052, 0.495173, 0.000865322, 0.429175, - 0.00224487, 0.494999, 0.00194637, 0.429129, - 0.00399041, 0.494952, 0.00346004, 0.429153, - 0.00623476, 0.494974, 0.00540684, 0.429168, - 0.0089773, 0.494983, 0.00778714, 0.429207, - 0.0122175, 0.495012, 0.0106022, 0.429257, - 0.0159542, 0.495047, 0.0138535, 0.429338, - 0.0201864, 0.495106, 0.0175443, 0.429431, - 0.0249104, 0.495165, 0.0216774, 0.429587, - 0.0301252, 0.495279, 0.0262594, 0.429796, - 0.0358249, 0.495432, 0.0312968, 0.430065, - 0.0419972, 0.495621, 0.0367985, 0.430588, - 0.0485144, 0.496061, 0.042798, 0.43113, - 0.0555028, 0.496472, 0.0492914, 0.431743, - 0.0629852, 0.496904, 0.0562907, 0.432448, - 0.0709256, 0.497369, 0.0638056, 0.433414, - 0.0791942, 0.498032, 0.071885, 0.434638, - 0.0877346, 0.498854, 0.0805517, 0.43611, - 0.0968056, 0.499812, 0.0898047, 0.437859, - 0.106002, 0.500891, 0.0997142, 0.440017, - 0.115648, 0.502198, 0.110289, 0.443236, - 0.125427, 0.504389, 0.121644, 0.44697, - 0.135492, 0.506809, 0.133769, 0.451689, - 0.145746, 0.509858, 0.146787, 0.45811, - 0.156219, 0.514247, 0.160793, 0.465305, - 0.166834, 0.518816, 0.175791, 0.474085, - 0.177546, 0.524331, 0.191906, 0.484808, - 0.188262, 0.53104, 0.209199, 0.49732, - 0.199346, 0.538511, 0.227825, 0.509693, - 0.209951, 0.544554, 0.247269, 0.524367, - 0.220533, 0.551616, 0.267978, 0.539228, - 0.231082, 0.557368, 0.289672, 0.55644, - 0.241342, 0.563782, 0.31268, 0.574204, - 0.250964, 0.568851, 0.33651, 0.593388, - 0.260306, 0.57312, 0.362219, 0.613358, - 0.268667, 0.574916, 0.390322, 0.634512, - 0.275591, 0.575053, 0.420478, 0.65563, - 0.281328, 0.572404, 0.451614, 0.678265, - 0.285948, 0.568893, 0.484112, 0.70011, - 0.289408, 0.561878, 0.517348, 0.723005, - 0.291328, 0.55359, 0.551355, 0.743744, - 0.291418, 0.541099, 0.585109, 0.763949, - 0.290252, 0.526489, 0.619487, 0.784186, - 0.287648, 0.509496, 0.65404, 0.804304, - 0.283782, 0.491484, 0.688649, 0.823629, - 0.278067, 0.470517, 0.723133, 0.84094, - 0.270588, 0.44705, 0.757163, 0.857852, - 0.261188, 0.421252, 0.792816, 0.874934, - 0.249313, 0.394191, 0.827248, 0.888709, - 0.236492, 0.365359, 0.861074, 0.902589, - 0.222185, 0.336016, 0.894417, 0.914201, - 0.207314, 0.30527, 0.926825, 0.925978, - 0.191146, 0.274532, 0.9595, 0.93512, - 0.174135, 0.243393, 0.991583, 0.943656, - 0.155231, 0.212414, 1.02356, 0.951719, - 0.134403, 0.182005, 1.05239, 0.957164, - 0.113023, 0.153043, 1.07754, 0.962656, - 0.0914493, 0.124186, 1.09984, 0.970695, - 0.0694179, 0.0941654, 1.12, 0.980749, - 0.0466199, 0.0629671, 1.13849, 0.991205, - 0.0227032, 0.0311146, 1.15494, 0.999884, 0.000632388, - 0.000254483, 1.1706, 0.379821, - 9.57289e-06, 0.460637, 7.89337e-06, 0.405188, - 0.000247483, 0.491396, 0.000204064, 0.404796, - 0.000989434, 0.490914, 0.000815853, 0.40483, - 0.00222607, 0.490949, 0.00183559, 0.40473, - 0.00395723, 0.49084, 0.00326332, 0.404731, - 0.00618287, 0.490836, 0.00509945, 0.404768, - 0.00890258, 0.490871, 0.00734463, 0.404791, - 0.0121156, 0.490883, 0.00999992, 0.404857, - 0.0158214, 0.490938, 0.0130676, 0.404943, - 0.0200178, 0.491004, 0.0165503, 0.405059, - 0.0247027, 0.491093, 0.0204521, 0.405213, - 0.0298729, 0.491205, 0.0247788, 0.405399, - 0.0355226, 0.491333, 0.0295373, 0.405731, - 0.0416352, 0.491604, 0.034741, 0.406303, - 0.0480807, 0.492116, 0.0404255, 0.406814, - 0.0550458, 0.492506, 0.0465732, 0.407404, - 0.0624652, 0.492926, 0.0532058, 0.408149, - 0.0702958, 0.493442, 0.0603442, 0.409128, - 0.0784623, 0.494136, 0.0680297, 0.410408, - 0.087007, 0.495054, 0.0762786, 0.411813, - 0.0959639, 0.495962, 0.0851046, 0.413735, - 0.105075, 0.497257, 0.0945878, 0.416137, - 0.114646, 0.498882, 0.104725, 0.41934, - 0.124394, 0.501132, 0.11563, 0.423326, - 0.134328, 0.503883, 0.127325, 0.428419, - 0.14458, 0.50747, 0.139911, 0.43484, - 0.154979, 0.511964, 0.153481, 0.442641, - 0.165628, 0.517328, 0.168114, 0.452511, - 0.176365, 0.524258, 0.183995, 0.463473, - 0.187298, 0.531248, 0.200953, 0.475564, - 0.198244, 0.538367, 0.219176, 0.488664, - 0.208938, 0.545175, 0.238514, 0.504073, - 0.219599, 0.553227, 0.259129, 0.520832, - 0.230378, 0.560653, 0.280997, 0.538455, - 0.240703, 0.567523, 0.303821, 0.55709, - 0.250548, 0.573287, 0.327948, 0.576646, - 0.259964, 0.577795, 0.353362, 0.596705, - 0.268721, 0.580077, 0.380336, 0.618053, - 0.276054, 0.58018, 0.4101, 0.640303, - 0.282176, 0.578747, 0.44161, 0.662365, - 0.286931, 0.574294, 0.474106, 0.684542, - 0.290521, 0.567035, 0.507549, 0.707984, - 0.292672, 0.558687, 0.541853, 0.730913, - 0.293189, 0.547606, 0.576581, 0.752948, - 0.292199, 0.533471, 0.61172, 0.773452, - 0.289508, 0.516395, 0.646339, 0.794715, - 0.285716, 0.497873, 0.682131, 0.814251, - 0.280051, 0.476845, 0.716396, 0.833057, - 0.272873, 0.453449, 0.751503, 0.84959, - 0.263982, 0.427857, 0.786085, 0.867022, - 0.252745, 0.400335, 0.821355, 0.882277, - 0.239655, 0.371304, 0.85646, 0.895375, - 0.225386, 0.340397, 0.890828, 0.909347, - 0.209587, 0.310005, 0.923532, 0.921885, - 0.193433, 0.2796, 0.956419, 0.932127, - 0.176135, 0.247276, 0.989445, 0.941869, - 0.157872, 0.216186, 1.02221, 0.949735, - 0.137577, 0.185602, 1.05195, 0.956617, - 0.115285, 0.155767, 1.07822, 0.961974, - 0.0928418, 0.126103, 1.10149, 0.96972, - 0.0700592, 0.0956758, 1.12207, 0.98012, - 0.0474671, 0.0643269, 1.1408, 0.990825, - 0.0238113, 0.0320863, 1.1577, 0.999876, 0.000381574, - 8.12203e-05, 1.17403, 0.367636, - 9.61342e-06, 0.469176, 7.53287e-06, 0.380377, - 0.000244772, 0.485434, 0.000191797, 0.380416, - 0.000978857, 0.485475, 0.000767015, 0.380376, - 0.00220165, 0.485435, 0.00172522, 0.380419, - 0.00391408, 0.485487, 0.00306734, 0.380438, - 0.00611549, 0.485505, 0.00479332, 0.380462, - 0.00880558, 0.485525, 0.00690391, 0.380496, - 0.0119837, 0.485551, 0.00940039, 0.38056, - 0.0156487, 0.485605, 0.0122848, 0.38064, - 0.0197988, 0.485666, 0.0155601, 0.380767, - 0.0244324, 0.48577, 0.0192313, 0.380909, - 0.0295444, 0.485871, 0.0233032, 0.381142, - 0.0351321, 0.48606, 0.0277861, 0.381472, - 0.0411535, 0.486336, 0.0326939, 0.382015, - 0.0475408, 0.486833, 0.0380565, 0.382523, - 0.0544395, 0.487231, 0.0438615, 0.383129, - 0.061784, 0.487683, 0.0501332, 0.383952, - 0.0695085, 0.488313, 0.0568996, 0.38498, - 0.0775819, 0.489077, 0.0641952, 0.386331, - 0.0860443, 0.490113, 0.0720324, 0.387788, - 0.0948406, 0.491099, 0.0804379, 0.389808, - 0.103899, 0.492566, 0.0894899, 0.39252, - 0.113313, 0.494601, 0.0992098, 0.395493, - 0.123007, 0.496619, 0.109641, 0.399826, - 0.132859, 0.499912, 0.120919, 0.405341, - 0.143077, 0.504061, 0.133107, 0.411932, - 0.153465, 0.508905, 0.146263, 0.420591, - 0.164108, 0.515482, 0.160544, 0.43101, - 0.174893, 0.523191, 0.176123, 0.441881, - 0.185839, 0.53026, 0.192757, 0.453919, - 0.196633, 0.537295, 0.210535, 0.468715, - 0.207611, 0.546156, 0.229886, 0.485182, - 0.218517, 0.555173, 0.250543, 0.501926, - 0.229249, 0.562728, 0.27221, 0.51785, - 0.239481, 0.567494, 0.294892, 0.536947, - 0.249395, 0.573889, 0.318987, 0.557115, - 0.259, 0.578831, 0.344348, 0.577966, - 0.268075, 0.582055, 0.371223, 0.599489, - 0.276115, 0.583307, 0.399834, 0.62479, - 0.282523, 0.583902, 0.431415, 0.647504, - 0.287663, 0.57953, 0.464301, 0.670601, - 0.291538, 0.573103, 0.498123, 0.693539, - 0.293842, 0.563731, 0.532662, 0.717385, - 0.294681, 0.553169, 0.567925, 0.741533, - 0.293717, 0.539908, 0.603502, 0.762142, - 0.291156, 0.521902, 0.639074, 0.783014, - 0.28719, 0.502815, 0.674439, 0.805158, - 0.281773, 0.482598, 0.710497, 0.823646, - 0.274682, 0.458949, 0.7456, 0.841879, - 0.266184, 0.433129, 0.781085, 0.859515, - 0.255682, 0.406064, 0.816, 0.875335, - 0.242849, 0.376509, 0.851074, 0.890147, - 0.228329, 0.345502, 0.886473, 0.903144, - 0.212491, 0.31428, 0.920751, 0.916618, - 0.195695, 0.282994, 0.954606, 0.927953, - 0.178267, 0.251091, 0.988402, 0.937414, - 0.159549, 0.219107, 1.02141, 0.946823, - 0.140022, 0.18896, 1.05167, 0.954651, - 0.118154, 0.158667, 1.07819, 0.959955, - 0.0946636, 0.128808, 1.1025, 0.96858, - 0.0711792, 0.0973787, 1.12391, 0.97938, - 0.0475046, 0.0650965, 1.14322, 0.990498, - 0.024059, 0.0326267, 1.16077, 0.999844, - 5.12408e-05, 0.000112444, 1.17727, 0.316912, - 9.34977e-06, 0.425996, 6.95559e-06, 0.356423, - 0.000241372, 0.479108, 0.000179562, 0.356272, - 0.000965292, 0.478897, 0.00071811, 0.356262, - 0.00217182, 0.478894, 0.00161574, 0.356265, - 0.00386092, 0.478895, 0.00287261, 0.356278, - 0.0060324, 0.478905, 0.00448907, 0.356293, - 0.00868565, 0.478914, 0.00646572, 0.356346, - 0.0118207, 0.478965, 0.00880438, 0.356395, - 0.0154355, 0.479001, 0.0115066, 0.356484, - 0.019529, 0.479075, 0.0145762, 0.356609, - 0.0240991, 0.47918, 0.018018, 0.356766, - 0.0291413, 0.479305, 0.0218379, 0.357009, - 0.0346498, 0.479512, 0.0260454, 0.357424, - 0.0405462, 0.479909, 0.0306657, 0.357899, - 0.0468825, 0.480337, 0.0357054, 0.358424, - 0.0536887, 0.480771, 0.0411728, 0.359041, - 0.0609416, 0.481242, 0.0470841, 0.359903, - 0.0685239, 0.481943, 0.0534831, 0.360932, - 0.0764883, 0.482741, 0.0603795, 0.362196, - 0.0848364, 0.483688, 0.0678028, 0.363847, - 0.0935002, 0.484947, 0.0758086, 0.365972, - 0.102471, 0.486588, 0.0844173, 0.368741, - 0.111751, 0.488787, 0.0937199, 0.372146, - 0.121334, 0.491405, 0.103732, 0.377114, - 0.131147, 0.495604, 0.114608, 0.38226, - 0.141213, 0.499436, 0.126345, 0.389609, - 0.151632, 0.505334, 0.139116, 0.397925, - 0.162073, 0.51168, 0.152995, 0.407824, - 0.172819, 0.518876, 0.168071, 0.420014, - 0.183929, 0.527639, 0.184495, 0.434266, - 0.195032, 0.537588, 0.20232, 0.447352, - 0.205792, 0.544379, 0.221189, 0.463726, - 0.216704, 0.553422, 0.241616, 0.481406, - 0.227531, 0.562074, 0.263298, 0.498707, - 0.238017, 0.568227, 0.286116, 0.518039, - 0.247936, 0.574473, 0.3101, 0.538277, - 0.257437, 0.579191, 0.335401, 0.561166, - 0.266829, 0.584807, 0.362246, 0.583189, - 0.275329, 0.586476, 0.390609, 0.606024, - 0.28234, 0.585578, 0.420998, 0.632419, - 0.287924, 0.584496, 0.454357, 0.656128, - 0.291972, 0.577766, 0.488233, 0.679953, - 0.29456, 0.56875, 0.523248, 0.704654, - 0.295816, 0.558388, 0.559168, 0.729016, - 0.295157, 0.544826, 0.595326, 0.752062, - 0.292779, 0.528273, 0.631864, 0.773138, - 0.288681, 0.508482, 0.667793, 0.794869, - 0.283358, 0.487341, 0.704035, 0.815101, - 0.27608, 0.46354, 0.739925, 0.834212, - 0.26767, 0.438672, 0.775539, 0.852368, - 0.257397, 0.411239, 0.810895, 0.870207, - 0.245689, 0.3829, 0.846472, 0.884063, - 0.231452, 0.351496, 0.881788, 0.898284, - 0.215561, 0.31895, 0.917438, 0.912964, - 0.198208, 0.287367, 0.952422, 0.924666, - 0.180426, 0.254487, 0.987551, 0.934429, - 0.161525, 0.222226, 1.02142, 0.943485, - 0.141197, 0.191143, 1.05218, 0.9521, - 0.120085, 0.161112, 1.07937, 0.957876, - 0.0975881, 0.130982, 1.10403, 0.966943, - 0.0726842, 0.0990553, 1.12616, 0.978313, - 0.0483705, 0.0662818, 1.14619, 0.990048, - 0.0239072, 0.0329243, 1.16413, 0.999984, 0.000461885, - 7.72859e-05, 1.18099, 0.321287, - 9.35049e-06, 0.455413, 6.59662e-06, 0.332595, - 0.000237513, 0.471437, 0.000167562, 0.332729, - 0.000949964, 0.471618, 0.000670192, 0.332305, - 0.00213618, 0.471028, 0.00150712, 0.332326, - 0.00379765, 0.471055, 0.00267959, 0.332344, - 0.00593353, 0.471072, 0.00418751, 0.332356, - 0.00854349, 0.471077, 0.00603172, 0.332403, - 0.0116268, 0.471121, 0.00821362, 0.332461, - 0.0151824, 0.47117, 0.0107357, 0.332552, - 0.0192088, 0.471251, 0.0136014, 0.332657, - 0.0237024, 0.47133, 0.0168152, 0.332835, - 0.0286615, 0.471487, 0.0203853, 0.333083, - 0.0340765, 0.471708, 0.0243212, 0.333547, - 0.0398563, 0.47219, 0.0286518, 0.333989, - 0.0460916, 0.472587, 0.0333763, 0.334532, - 0.0527897, 0.473054, 0.0385084, 0.335167, - 0.0599284, 0.473568, 0.0440638, 0.33608, - 0.0673514, 0.474362, 0.0500962, 0.337146, - 0.0752237, 0.475231, 0.0566022, 0.338462, - 0.083418, 0.476282, 0.0636272, 0.34014, - 0.0919382, 0.477615, 0.0712153, 0.342341, - 0.100741, 0.479404, 0.079417, 0.345088, - 0.109905, 0.481618, 0.0882631, 0.349049, - 0.119369, 0.485081, 0.0978851, 0.353939, - 0.129033, 0.489317, 0.108336, 0.359893, - 0.139038, 0.494309, 0.119698, 0.366945, - 0.149411, 0.499983, 0.132024, 0.375814, - 0.159843, 0.507185, 0.145558, 0.387112, - 0.170664, 0.516392, 0.160433, 0.40023, - 0.181897, 0.526519, 0.176648, 0.412555, - 0.192785, 0.53423, 0.193922, 0.427023, - 0.203663, 0.542741, 0.212662, 0.443685, - 0.214695, 0.552066, 0.232944, 0.461499, - 0.225561, 0.560762, 0.254495, 0.480975, - 0.236257, 0.569421, 0.277531, 0.501, - 0.24639, 0.576101, 0.301724, 0.521691, - 0.256101, 0.581493, 0.327112, 0.543478, - 0.265289, 0.585221, 0.353917, 0.566094, - 0.273938, 0.587614, 0.381941, 0.589578, - 0.281679, 0.587991, 0.41172, 0.614583, - 0.287655, 0.585928, 0.444148, 0.641813, - 0.292228, 0.582092, 0.478617, 0.666189, - 0.295172, 0.57398, 0.51397, 0.690475, - 0.29648, 0.561676, 0.550118, 0.715543, - 0.296203, 0.548758, 0.586933, 0.740405, - 0.293999, 0.532792, 0.62384, 0.762183, - 0.28998, 0.512735, 0.660723, 0.786069, - 0.28478, 0.492402, 0.69807, 0.806812, - 0.277568, 0.469058, 0.734422, 0.826987, - 0.268951, 0.443017, 0.770946, 0.844588, - 0.259049, 0.415501, 0.80699, 0.863725, - 0.2471, 0.387328, 0.842107, 0.879137, - 0.234157, 0.356108, 0.878078, 0.894634, - 0.218719, 0.324315, 0.914058, 0.909162, - 0.201293, 0.291813, 0.949922, 0.92072, - 0.18267, 0.258474, 0.985337, 0.93158, - 0.163212, 0.225593, 1.0205, 0.941238, - 0.142771, 0.193986, 1.05273, 0.949293, - 0.120956, 0.163392, 1.08075, 0.956226, - 0.0985743, 0.132934, 1.10559, 0.96546, - 0.075118, 0.101255, 1.12823, 0.977403, - 0.0497921, 0.0675441, 1.149, 0.989648, - 0.0241574, 0.0334681, 1.16765, 1.00001, 0.0005762, - 0.000184807, 1.18519, 0.303474, - 9.16603e-06, 0.4542, 6.1243e-06, 0.308894, - 0.000232869, 0.462306, 0.000155592, 0.309426, - 0.000931661, 0.463093, 0.000622499, 0.308643, - 0.0020949, 0.461933, 0.00139979, 0.308651, - 0.0037242, 0.461941, 0.00248874, 0.308662, - 0.00581873, 0.46195, 0.00388933, 0.308687, - 0.00837818, 0.461974, 0.00560247, 0.308728, - 0.0114016, 0.462011, 0.00762948, 0.308789, - 0.0148884, 0.462067, 0.00997326, 0.308882, - 0.0188369, 0.462151, 0.0126375, 0.309007, - 0.0232436, 0.462263, 0.0156271, 0.30918, - 0.0281054, 0.462417, 0.0189498, 0.309442, - 0.0334065, 0.462667, 0.0226167, 0.309901, - 0.0390589, 0.463162, 0.0266614, 0.310331, - 0.0452042, 0.463555, 0.0310715, 0.310858, - 0.0517735, 0.464019, 0.0358698, 0.311576, - 0.0587359, 0.464669, 0.0410848, 0.312436, - 0.0660383, 0.465406, 0.0467453, 0.313526, - 0.0737266, 0.466339, 0.0528718, 0.314903, - 0.0817574, 0.467504, 0.0595039, 0.316814, - 0.090167, 0.469226, 0.0666888, 0.318965, - 0.0987555, 0.470981, 0.0744658, 0.322077, - 0.107792, 0.473814, 0.082912, 0.325947, - 0.117098, 0.477241, 0.0920846, 0.331008, - 0.126602, 0.48184, 0.102137, 0.337893, - 0.136619, 0.488334, 0.113135, 0.345106, - 0.146838, 0.494415, 0.12511, 0.355111, - 0.157357, 0.503275, 0.138356, 0.365095, - 0.167955, 0.510966, 0.152686, 0.378344, - 0.179157, 0.521508, 0.16856, 0.391599, - 0.190143, 0.530455, 0.18561, 0.407786, - 0.20123, 0.541275, 0.204308, 0.425294, - 0.212456, 0.551784, 0.224623, 0.444021, - 0.223568, 0.561493, 0.246172, 0.463418, - 0.234154, 0.569886, 0.268979, 0.484077, - 0.244546, 0.577116, 0.293411, 0.505513, - 0.254301, 0.582914, 0.318936, 0.527672, - 0.263564, 0.587208, 0.345856, 0.550565, - 0.272332, 0.589277, 0.374054, 0.573656, - 0.280011, 0.588426, 0.403276, 0.59827, - 0.286924, 0.587504, 0.43474, 0.624731, - 0.291994, 0.583401, 0.468767, 0.652396, - 0.295159, 0.576997, 0.504411, 0.67732, - 0.296954, 0.565863, 0.54114, 0.703147, - 0.296877, 0.552316, 0.57816, 0.728715, - 0.295147, 0.536773, 0.616124, 0.752448, - 0.291275, 0.51771, 0.653885, 0.775169, - 0.285905, 0.496087, 0.691537, 0.799307, - 0.279064, 0.474232, 0.729251, 0.819482, - 0.270294, 0.447676, 0.766267, 0.837659, - 0.260032, 0.419656, 0.802616, 0.856903, - 0.248497, 0.391328, 0.838583, 0.873325, - 0.235252, 0.360285, 0.874711, 0.889788, - 0.221126, 0.329215, 0.91077, 0.904486, - 0.204304, 0.296392, 0.94653, 0.917711, - 0.185562, 0.262159, 0.983828, 0.928969, - 0.165635, 0.229142, 1.01955, 0.939707, - 0.14442, 0.19673, 1.05317, 0.948167, - 0.122147, 0.165095, 1.0823, 0.955222, - 0.099098, 0.13451, 1.10791, 0.964401, - 0.0755332, 0.102476, 1.1312, 0.976605, - 0.0513817, 0.0689667, 1.15218, 0.989085, - 0.0258499, 0.034506, 1.17129, 0.999908, 0.000617773, - 0.000271268, 1.18961, 0.285803, - 9.05752e-06, 0.452348, 5.72272e-06, 0.284689, - 0.00022732, 0.450581, 0.000143626, 0.285263, - 0.000910214, 0.451482, 0.000575099, 0.285302, - 0.00204784, 0.451553, 0.00129395, 0.285318, - 0.00364057, 0.451574, 0.0023006, 0.28533, - 0.00568813, 0.451585, 0.00359547, 0.285361, - 0.00819001, 0.451618, 0.00517934, 0.285397, - 0.0111458, 0.45165, 0.007054, 0.285447, - 0.0145536, 0.451688, 0.00922167, 0.285527, - 0.0184127, 0.451758, 0.0116869, 0.285688, - 0.0227207, 0.451929, 0.0144555, 0.28584, - 0.0274712, 0.452055, 0.0175341, 0.286136, - 0.0326278, 0.452369, 0.0209406, 0.286574, - 0.0381792, 0.452853, 0.0246965, 0.287012, - 0.0441879, 0.453272, 0.0287996, 0.287542, - 0.0506096, 0.453752, 0.033268, 0.288299, - 0.0573634, 0.454488, 0.0381504, 0.289186, - 0.0645458, 0.455294, 0.0434447, 0.290302, - 0.0720405, 0.456301, 0.0491973, 0.291776, - 0.0799046, 0.457648, 0.0554453, 0.29372, - 0.088117, 0.459483, 0.0622311, 0.296052, - 0.0965328, 0.461571, 0.0695992, 0.299563, - 0.105409, 0.465085, 0.077658, 0.30335, - 0.114553, 0.468506, 0.0864176, 0.309167, - 0.123917, 0.474423, 0.0961078, 0.31529, - 0.13381, 0.47995, 0.106643, 0.324163, - 0.144021, 0.488592, 0.118322, 0.333272, - 0.154382, 0.496461, 0.131133, 0.344224, - 0.165015, 0.50562, 0.145208, 0.357733, - 0.176168, 0.516719, 0.16073, 0.373046, - 0.187468, 0.528513, 0.177807, 0.38788, - 0.198488, 0.537713, 0.196072, 0.405133, - 0.209545, 0.547999, 0.21605, 0.423845, - 0.220724, 0.55759, 0.237484, 0.443777, - 0.231518, 0.566246, 0.26039, 0.464824, - 0.242035, 0.574326, 0.284835, 0.486635, - 0.251898, 0.58037, 0.310518, 0.51012, - 0.261304, 0.58568, 0.337678, 0.535301, - 0.270384, 0.590197, 0.366242, 0.559193, - 0.27841, 0.590569, 0.395873, 0.583544, - 0.285325, 0.588161, 0.426857, 0.608834, - 0.291113, 0.584249, 0.459477, 0.635753, - 0.294882, 0.57763, 0.494734, 0.664367, - 0.297088, 0.569479, 0.532023, 0.689688, - 0.297364, 0.555064, 0.569629, 0.715732, - 0.295949, 0.539522, 0.608124, 0.741307, - 0.292259, 0.521613, 0.646231, 0.764949, - 0.287063, 0.49969, 0.684938, 0.788599, - 0.28012, 0.476747, 0.723548, 0.81048, - 0.27153, 0.45116, 0.761135, 0.831372, - 0.261289, 0.424101, 0.798916, 0.850092, - 0.249559, 0.39443, 0.835952, 0.867777, - 0.236348, 0.363849, 0.871606, 0.884632, - 0.221569, 0.332477, 0.907843, 0.90047, - 0.20618, 0.300667, 0.944187, 0.914524, - 0.188771, 0.266552, 0.981371, 0.926892, - 0.168362, 0.232349, 1.01841, 0.937951, - 0.146761, 0.199359, 1.05308, 0.947236, - 0.123813, 0.1675, 1.0839, 0.954367, - 0.099984, 0.136166, 1.11047, 0.963907, - 0.0759278, 0.103808, 1.13414, 0.976218, - 0.0511367, 0.0697061, 1.15575, 0.988772, - 0.0267415, 0.0352529, 1.17531, 0.999888, - 0.000520778, 0.000289926, 1.19389, 0.263546, - 8.83274e-06, 0.441896, 5.26783e-06, 0.262352, - 0.000221849, 0.439889, 0.000132311, 0.262325, - 0.000886683, 0.439848, 0.000528824, 0.26228, - 0.00199476, 0.439765, 0.00118975, 0.262372, - 0.00354671, 0.439922, 0.00211568, 0.26239, - 0.00554141, 0.439941, 0.00330652, 0.262412, - 0.00797888, 0.439961, 0.00476346, 0.262453, - 0.0108584, 0.440002, 0.00648818, 0.262528, - 0.0141788, 0.440085, 0.0084835, 0.262615, - 0.017938, 0.440166, 0.0107533, 0.262744, - 0.0221346, 0.440291, 0.0133044, 0.262939, - 0.026762, 0.440493, 0.0161445, 0.263277, - 0.0317573, 0.440889, 0.0192974, 0.26368, - 0.0371832, 0.441338, 0.0227699, 0.264106, - 0.0430371, 0.441753, 0.0265698, 0.264624, - 0.0493035, 0.442227, 0.0307178, 0.265378, - 0.0558669, 0.442985, 0.0352616, 0.266253, - 0.0628718, 0.443795, 0.0401968, 0.267478, - 0.0701569, 0.445008, 0.04559, 0.269062, - 0.077845, 0.446599, 0.0514539, 0.270926, - 0.0857941, 0.448349, 0.0578382, 0.273693, - 0.0940773, 0.451221, 0.0648363, 0.276746, - 0.102704, 0.454097, 0.0724389, 0.281693, - 0.111735, 0.459517, 0.0808744, 0.287335, - 0.121004, 0.46531, 0.0901551, 0.29448, - 0.130734, 0.472605, 0.100371, 0.30257, - 0.140777, 0.480251, 0.111644, 0.312465, - 0.15111, 0.489444, 0.124111, 0.324856, - 0.16189, 0.500919, 0.137979, 0.33774, - 0.172946, 0.511317, 0.153163, 0.35255, - 0.184152, 0.522684, 0.169817, 0.367786, - 0.19522, 0.53248, 0.187886, 0.385474, - 0.20632, 0.543326, 0.207634, 0.404976, - 0.217744, 0.554109, 0.229165, 0.425203, - 0.228691, 0.563395, 0.252068, 0.446704, - 0.239299, 0.571565, 0.276471, 0.468951, - 0.249348, 0.577935, 0.302323, 0.493487, - 0.258933, 0.584309, 0.329882, 0.517861, - 0.268009, 0.58773, 0.358525, 0.543309, - 0.276238, 0.589612, 0.388585, 0.569704, - 0.28356, 0.589294, 0.419787, 0.594871, - 0.289497, 0.585137, 0.452114, 0.622555, - 0.294452, 0.580356, 0.486466, 0.651167, - 0.296918, 0.57185, 0.523079, 0.677332, - 0.297647, 0.558428, 0.5611, 0.703718, - 0.296321, 0.542232, 0.599592, 0.730262, - 0.293339, 0.524541, 0.639138, 0.754304, - 0.288036, 0.502691, 0.677978, 0.778051, - 0.281018, 0.479212, 0.716537, 0.801557, - 0.272414, 0.454071, 0.75586, 0.822559, - 0.262419, 0.425952, 0.794477, 0.843051, - 0.250702, 0.397313, 0.832664, 0.86232, - 0.237264, 0.366534, 0.869876, 0.879044, - 0.222716, 0.334816, 0.906973, 0.896362, - 0.206827, 0.303143, 0.943558, 0.910342, - 0.189659, 0.269699, 0.979759, 0.924119, - 0.171108, 0.236411, 1.01718, 0.935374, - 0.149579, 0.202224, 1.05289, 0.944295, - 0.126295, 0.16989, 1.08496, 0.952227, - 0.101511, 0.138089, 1.11256, 0.962041, - 0.0766392, 0.105053, 1.1375, 0.97528, - 0.0511967, 0.070329, 1.15983, 0.988476, - 0.025463, 0.0351268, 1.17987, 0.999962, 2.86808e-05, 1.45564e-05, 1.19901, 0.227089, - 8.41413e-06, 0.404216, 4.72707e-06, 0.239725, - 0.000215083, 0.426708, 0.000120833, 0.239904, - 0.000860718, 0.427028, 0.000483555, 0.239911, - 0.00193661, 0.427039, 0.00108806, 0.239914, - 0.00344276, 0.42704, 0.00193457, 0.239933, - 0.00537907, 0.427064, 0.00302363, 0.239944, - 0.00774482, 0.427065, 0.00435604, 0.239993, - 0.01054, 0.427122, 0.00593398, 0.240052, - 0.0137626, 0.427179, 0.00775987, 0.240148, - 0.0174115, 0.427279, 0.00983854, 0.240278, - 0.021484, 0.42741, 0.0121763, 0.240472, - 0.0259729, 0.427618, 0.0147827, 0.240839, - 0.0308131, 0.428086, 0.0176837, 0.241201, - 0.0360893, 0.428482, 0.0208775, 0.241626, - 0.0417723, 0.428907, 0.0243821, 0.242207, - 0.0478337, 0.42952, 0.0282228, 0.24298, - 0.0542199, 0.430332, 0.0324333, 0.243881, - 0.0610015, 0.431222, 0.0370252, 0.245123, - 0.0680874, 0.432512, 0.0420535, 0.24667, - 0.0755482, 0.434088, 0.0475414, 0.248779, - 0.0832873, 0.436323, 0.0535542, 0.251665, - 0.0913546, 0.439509, 0.0601716, 0.255305, - 0.0998489, 0.443478, 0.0674282, 0.260049, - 0.108576, 0.448713, 0.0754673, 0.266192, - 0.117754, 0.455524, 0.084339, 0.273158, - 0.127294, 0.4627, 0.0941683, 0.282131, - 0.137311, 0.472068, 0.10515, 0.293332, - 0.147736, 0.483565, 0.117402, 0.304667, - 0.158357, 0.493702, 0.130824, 0.317785, - 0.169274, 0.504708, 0.145724, 0.333245, - 0.180595, 0.517107, 0.16215, 0.349843, - 0.191892, 0.528849, 0.180149, 0.367944, - 0.203168, 0.540301, 0.199746, 0.387579, - 0.214443, 0.551514, 0.221047, 0.408247, - 0.225624, 0.560906, 0.243981, 0.43014, - 0.236422, 0.56959, 0.268513, 0.452669, - 0.24654, 0.576098, 0.294409, 0.476196, - 0.256157, 0.580925, 0.322002, 0.501157, - 0.265289, 0.584839, 0.351052, 0.527632, - 0.273671, 0.587614, 0.3812, 0.555754, - 0.281254, 0.589119, 0.412994, 0.581682, - 0.287448, 0.585204, 0.445498, 0.608196, - 0.292614, 0.579006, 0.479505, 0.635661, - 0.296068, 0.571297, 0.514643, 0.664999, - 0.297395, 0.560855, 0.552213, 0.691039, - 0.296645, 0.544525, 0.591365, 0.7179, - 0.293785, 0.526535, 0.630883, 0.744059, - 0.289089, 0.50545, 0.670932, 0.76863, - 0.282239, 0.482514, 0.710904, 0.793273, - 0.273688, 0.457246, 0.750259, 0.814731, - 0.26328, 0.428872, 0.78948, 0.835603, - 0.251526, 0.399384, 0.828597, 0.85489, - 0.238339, 0.368811, 0.866892, 0.872828, - 0.223607, 0.336617, 0.90563, 0.889462, - 0.207538, 0.303997, 0.943538, 0.904929, - 0.190297, 0.270812, 0.980591, 0.919101, - 0.172034, 0.237453, 1.01935, 0.930536, - 0.152058, 0.204431, 1.05498, 0.941223, - 0.129515, 0.172495, 1.08717, 0.94982, - 0.104263, 0.140175, 1.11551, 0.960592, - 0.0781944, 0.106465, 1.14098, 0.974629, - 0.051688, 0.0711592, 1.16418, 0.98811, - 0.0253929, 0.0354432, 1.18465, 1.00004, 0.000804378, - 0.000330876, 1.20462, 0.214668, - 8.21282e-06, 0.406619, 4.33582e-06, 0.218053, - 0.000208144, 0.413025, 0.000109887, 0.217987, - 0.000832212, 0.412901, 0.000439362, 0.217971, - 0.00187246, 0.412876, 0.000988623, 0.217968, - 0.00332855, 0.41286, 0.00175772, 0.217985, - 0.00520055, 0.412882, 0.00274729, 0.218014, - 0.00748814, 0.412916, 0.00395842, 0.218054, - 0.0101901, 0.412957, 0.00539274, 0.218106, - 0.0133057, 0.413005, 0.00705348, 0.218217, - 0.0168342, 0.413139, 0.00894581, 0.218338, - 0.0207707, 0.413258, 0.0110754, 0.21855, - 0.0251001, 0.413509, 0.0134551, 0.218913, - 0.0297861, 0.413992, 0.0161081, 0.219265, - 0.0348956, 0.414383, 0.0190307, 0.219696, - 0.0403909, 0.414839, 0.0222458, 0.220329, - 0.0462003, 0.415567, 0.025792, 0.220989, - 0.0524208, 0.41621, 0.0296637, 0.222027, - 0.058948, 0.417385, 0.0339323, 0.223301, - 0.0658208, 0.418779, 0.0386055, 0.224988, - 0.0730347, 0.420665, 0.0437355, 0.227211, - 0.0805274, 0.423198, 0.0493844, 0.230131, - 0.088395, 0.426566, 0.0556135, 0.233908, - 0.0966208, 0.43091, 0.0624829, 0.239092, - 0.105223, 0.437148, 0.0701636, 0.245315, - 0.11424, 0.444302, 0.0786949, 0.253166, - 0.12368, 0.453262, 0.0882382, 0.262374, - 0.133569, 0.463211, 0.0988682, 0.273145, - 0.143836, 0.474271, 0.110727, 0.285512, - 0.154577, 0.4863, 0.123945, 0.299512, - 0.165501, 0.498817, 0.138581, 0.314287, - 0.176698, 0.510341, 0.154676, 0.331083, - 0.188066, 0.522583, 0.172459, 0.349615, - 0.199597, 0.534879, 0.191979, 0.369318, - 0.210843, 0.546083, 0.21309, 0.390377, - 0.222068, 0.5562, 0.235998, 0.412411, - 0.233059, 0.564704, 0.260518, 0.435715, - 0.24357, 0.572314, 0.286795, 0.461196, - 0.253356, 0.579395, 0.314559, 0.485587, - 0.262362, 0.581985, 0.343581, 0.511908, - 0.270895, 0.584347, 0.374367, 0.539798, - 0.278452, 0.58505, 0.406015, 0.567974, - 0.284877, 0.583344, 0.439168, 0.594303, - 0.290124, 0.577348, 0.473005, 0.622951, - 0.294183, 0.570751, 0.508534, 0.652404, - 0.296389, 0.561541, 0.544764, 0.679291, - 0.296605, 0.546426, 0.582927, 0.706437, - 0.294095, 0.528599, 0.622681, 0.734485, - 0.28978, 0.508676, 0.663567, 0.758841, - 0.283363, 0.484768, 0.704092, 0.78537, - 0.275015, 0.460434, 0.745101, 0.807315, - 0.264689, 0.432166, 0.784712, 0.8271, - 0.252597, 0.401807, 0.824241, 0.849191, - 0.239154, 0.371458, 0.863803, 0.867046, - 0.224451, 0.338873, 0.903063, 0.8852, - 0.208342, 0.306175, 0.942763, 0.901771, - 0.190684, 0.272759, 0.981559, 0.915958, - 0.172105, 0.239306, 1.02048, 0.928046, - 0.152214, 0.206071, 1.05765, 0.939961, - 0.130247, 0.17367, 1.08999, 0.948711, - 0.10672, 0.142201, 1.11829, 0.959305, - 0.0808688, 0.108454, 1.14467, 0.973009, - 0.0539145, 0.0728109, 1.16839, 0.987631, - 0.0262947, 0.0360625, 1.19004, 0.999978, 0.00132758, - 0.000559424, 1.21058, 0.193925, - 7.93421e-06, 0.391974, 3.92537e-06, 0.196746, - 0.000200315, 0.397675, 9.91033e-05, 0.19667, - 0.000801099, 0.397521, 0.000396342, 0.196633, - 0.00180246, 0.397445, 0.000891829, 0.196654, - 0.00320443, 0.397482, 0.00158582, 0.196659, - 0.00500647, 0.39748, 0.00247867, 0.196683, - 0.0072086, 0.397506, 0.00357167, 0.196728, - 0.00981001, 0.397562, 0.00486675, 0.196792, - 0.0128096, 0.397633, 0.00636707, 0.19689, - 0.0162055, 0.397746, 0.00807752, 0.197017, - 0.0199943, 0.397884, 0.0100052, 0.19729, - 0.024139, 0.39827, 0.0121691, 0.197583, - 0.0286671, 0.398639, 0.0145755, 0.197927, - 0.0335858, 0.399034, 0.0172355, 0.198383, - 0.0388806, 0.399554, 0.0201718, 0.199002, - 0.0444736, 0.400289, 0.0234194, 0.199739, - 0.0504583, 0.401111, 0.026984, 0.200784, - 0.056729, 0.402349, 0.0309217, 0.202075, - 0.0633643, 0.403841, 0.0352496, 0.203898, - 0.0703247, 0.406076, 0.0400313, 0.206199, - 0.0775565, 0.408841, 0.0453282, 0.209252, - 0.085184, 0.41259, 0.0511794, 0.213638, - 0.0931994, 0.418288, 0.0577459, 0.21881, - 0.101617, 0.424681, 0.0650508, 0.225642, - 0.11052, 0.433429, 0.0732759, 0.233717, - 0.119772, 0.442897, 0.0824683, 0.242823, - 0.129505, 0.452888, 0.0927484, 0.254772, - 0.139906, 0.466407, 0.104417, 0.266603, - 0.150402, 0.477413, 0.117211, 0.28073, - 0.161395, 0.490519, 0.131598, 0.295399, - 0.172465, 0.50201, 0.147407, 0.312705, - 0.183982, 0.515311, 0.165031, 0.331335, - 0.195532, 0.52786, 0.184336, 0.351037, - 0.206971, 0.5392, 0.205361, 0.372175, - 0.218117, 0.54941, 0.228043, 0.394548, - 0.229327, 0.558642, 0.25267, 0.419598, - 0.240052, 0.567861, 0.279071, 0.443922, - 0.249937, 0.573332, 0.306882, 0.471495, - 0.259407, 0.58013, 0.33661, 0.496769, - 0.267749, 0.580564, 0.367328, 0.524951, - 0.275524, 0.581696, 0.399753, 0.55318, - 0.282148, 0.579885, 0.433134, 0.581577, - 0.287533, 0.575471, 0.467534, 0.609231, - 0.291612, 0.567445, 0.502943, 0.637478, - 0.293911, 0.557657, 0.53871, 0.667795, - 0.295096, 0.546535, 0.576568, 0.694272, - 0.294073, 0.529561, 0.614929, 0.722937, - 0.290386, 0.510561, 0.655909, 0.749682, - 0.284481, 0.487846, 0.697663, 0.774754, - 0.276188, 0.462487, 0.738515, 0.799301, - 0.266215, 0.43481, 0.779802, 0.820762, - 0.254116, 0.404879, 0.820045, 0.843231, - 0.240393, 0.374559, 0.860294, 0.861857, - 0.225503, 0.341582, 0.900965, 0.880815, - 0.209382, 0.308778, 0.941727, 0.89766, - 0.19155, 0.275232, 0.980916, 0.912926, - 0.172346, 0.240938, 1.02162, 0.926391, - 0.151799, 0.207223, 1.0597, 0.938429, - 0.129968, 0.17484, 1.09291, 0.947834, - 0.10651, 0.142984, 1.12248, 0.958432, - 0.0824098, 0.109902, 1.149, 0.972402, - 0.0565242, 0.0744454, 1.1733, 0.987191, - 0.028427, 0.0373794, 1.19538, 0.999975, 3.85685e-05, - 4.203e-05, 1.21676, 0.178114, - 7.66075e-06, 0.385418, 3.54027e-06, 0.176074, - 0.000191966, 0.381002, 8.87135e-05, 0.17601, - 0.000767549, 0.380861, 0.000354715, 0.17598, - 0.00172696, 0.380798, 0.000798168, 0.175994, - 0.00307012, 0.380824, 0.00141928, 0.176017, - 0.00479684, 0.380858, 0.00221859, 0.176019, - 0.00690648, 0.380839, 0.00319714, 0.176072, - 0.00939888, 0.380913, 0.0043572, 0.176131, - 0.0122726, 0.380979, 0.005702, 0.176239, - 0.0155264, 0.38112, 0.00723689, 0.176371, - 0.0191551, 0.381272, 0.00896907, 0.176638, - 0.023117, 0.381669, 0.0109194, 0.176912, - 0.0274633, 0.382015, 0.0130903, 0.177279, - 0.032173, 0.382476, 0.0154949, 0.17774, - 0.0372219, 0.383041, 0.0181669, 0.178344, - 0.0426132, 0.38378, 0.0211209, 0.179153, - 0.0483309, 0.384773, 0.0243899, 0.180197, - 0.0543447, 0.386076, 0.0280062, 0.181581, - 0.0607122, 0.387809, 0.032004, 0.18344, - 0.0673855, 0.390205, 0.036453, 0.186139, - 0.0743989, 0.393944, 0.0414162, 0.189432, - 0.0817731, 0.39832, 0.0469394, 0.193795, - 0.0895464, 0.404188, 0.0531442, 0.199641, - 0.0978264, 0.4121, 0.0601374, 0.206679, - 0.106499, 0.421425, 0.0680078, 0.214865, - 0.115654, 0.431504, 0.076919, 0.224406, - 0.125268, 0.442526, 0.0868835, 0.235876, - 0.135475, 0.455465, 0.0981875, 0.248335, - 0.146023, 0.4681, 0.110759, 0.262868, - 0.157016, 0.482069, 0.124885, 0.278962, - 0.168245, 0.496182, 0.140645, 0.295082, - 0.17958, 0.507401, 0.157838, 0.313738, - 0.191227, 0.520252, 0.17695, 0.333573, - 0.202718, 0.531708, 0.197817, 0.356433, - 0.214424, 0.544509, 0.220785, 0.378853, - 0.225492, 0.55373, 0.245306, 0.402717, - 0.236236, 0.561348, 0.271593, 0.428375, - 0.246568, 0.568538, 0.299776, 0.454724, - 0.255941, 0.573462, 0.329433, 0.482291, - 0.264511, 0.576356, 0.360598, 0.509706, - 0.272129, 0.576446, 0.393204, 0.538805, - 0.278979, 0.575298, 0.427227, 0.568919, - 0.284528, 0.572154, 0.462157, 0.596804, - 0.288801, 0.564691, 0.497997, 0.625987, - 0.291334, 0.555134, 0.534467, 0.656414, - 0.292722, 0.545051, 0.571736, 0.683916, - 0.292185, 0.528813, 0.610158, 0.711809, - 0.290043, 0.51106, 0.649061, 0.739547, - 0.285246, 0.490103, 0.690081, 0.766914, - 0.277647, 0.465523, 0.732554, 0.791375, - 0.267603, 0.437718, 0.773982, 0.814772, - 0.256109, 0.40882, 0.81609, 0.836691, - 0.242281, 0.377823, 0.856849, 0.856984, - 0.227155, 0.34496, 0.898363, 0.876332, - 0.210395, 0.311335, 0.939471, 0.894988, - 0.192612, 0.277703, 0.980799, 0.911113, - 0.173236, 0.243019, 1.02215, 0.924092, - 0.152258, 0.209037, 1.06139, 0.936828, - 0.129575, 0.175909, 1.09635, 0.946869, - 0.10594, 0.143852, 1.12707, 0.958284, - 0.081318, 0.110289, 1.15419, 0.972325, - 0.0556133, 0.0747232, 1.17909, 0.986878, - 0.0297899, 0.0383149, 1.20163, 0.999936, - 0.00197169, 0.000912402, 1.22338, 0.151174, - 7.20365e-06, 0.351531, 3.09789e-06, 0.155594, - 0.00018279, 0.361806, 7.8608e-05, 0.156099, - 0.000731569, 0.362982, 0.000314615, 0.156053, - 0.00164578, 0.362869, 0.000707845, 0.156093, - 0.0029261, 0.362961, 0.00125884, 0.156099, - 0.00457155, 0.362959, 0.00196783, 0.15612, - 0.00658224, 0.362982, 0.00283622, 0.156168, - 0.00895774, 0.363048, 0.00386625, 0.156221, - 0.0116962, 0.363101, 0.00506109, 0.156324, - 0.0147973, 0.363241, 0.00642675, 0.156476, - 0.0182503, 0.363448, 0.00797175, 0.156731, - 0.0220266, 0.36384, 0.00971484, 0.156994, - 0.026176, 0.364179, 0.0116575, 0.157341, - 0.0306701, 0.36462, 0.0138207, 0.157867, - 0.0354591, 0.365364, 0.0162356, 0.15846, - 0.0406141, 0.366111, 0.0189092, 0.159308, - 0.0460519, 0.367248, 0.021885, 0.160426, - 0.0518096, 0.368767, 0.0252004, 0.161877, - 0.0578906, 0.370745, 0.0288825, 0.163995, - 0.0642812, 0.373831, 0.0330139, 0.16655, - 0.0710067, 0.377366, 0.0376283, 0.170237, - 0.0781522, 0.382799, 0.0428493, 0.175096, - 0.0857172, 0.389915, 0.0487324, 0.181069, - 0.0938025, 0.398487, 0.0554214, 0.188487, - 0.102363, 0.408799, 0.0630189, 0.197029, - 0.111343, 0.419991, 0.071634, 0.206684, - 0.120812, 0.431455, 0.0812797, 0.218698, - 0.131033, 0.445746, 0.0923651, 0.230726, - 0.141373, 0.457471, 0.104545, 0.245516, - 0.152387, 0.472388, 0.118449, 0.261551, - 0.163628, 0.486671, 0.133923, 0.277437, - 0.174814, 0.49762, 0.150849, 0.296662, - 0.186713, 0.51162, 0.169924, 0.31795, - 0.198513, 0.525435, 0.190848, 0.339422, - 0.210119, 0.536267, 0.213504, 0.362143, - 0.221354, 0.545982, 0.237947, 0.387198, - 0.23224, 0.555364, 0.264427, 0.412349, - 0.24257, 0.561489, 0.292519, 0.439274, - 0.252284, 0.566903, 0.322561, 0.466779, - 0.261023, 0.569614, 0.353952, 0.496011, - 0.26899, 0.571589, 0.387278, 0.524964, - 0.275498, 0.570325, 0.421356, 0.556518, - 0.281449, 0.568792, 0.457314, 0.584363, - 0.285526, 0.560268, 0.493199, 0.614214, - 0.28844, 0.55205, 0.530276, 0.645684, - 0.289777, 0.541906, 0.56855, 0.673446, - 0.289722, 0.526464, 0.606927, 0.701924, - 0.287792, 0.509872, 0.645945, 0.73037, - 0.284315, 0.490649, 0.685564, 0.757405, - 0.278804, 0.467964, 0.726511, 0.784025, - 0.269543, 0.441468, 0.768601, 0.808255, - 0.258117, 0.41216, 0.811321, 0.830739, - 0.244728, 0.380606, 0.853496, 0.851914, - 0.229428, 0.348111, 0.895374, 0.872586, - 0.212508, 0.314732, 0.937674, 0.891581, - 0.194025, 0.280338, 0.979869, 0.907641, - 0.174711, 0.245203, 1.02253, 0.922233, - 0.153509, 0.21077, 1.06371, 0.935878, - 0.130418, 0.177399, 1.09972, 0.946338, - 0.105558, 0.144507, 1.13124, 0.957265, - 0.080059, 0.110508, 1.15973, 0.971668, - 0.0539766, 0.0742311, 1.18515, 0.9866, - 0.0277101, 0.0375224, 1.20858, 1.00021, - 0.000515531, 0.000135226, 1.23135, 0.137468, - 6.86011e-06, 0.345041, 2.73315e-06, 0.13703, - 0.000173378, 0.343936, 6.90761e-05, 0.136986, - 0.000693048, 0.34383, 0.000276126, 0.136964, - 0.00155931, 0.343761, 0.000621337, 0.137003, - 0.00277211, 0.343863, 0.00110494, 0.137012, - 0.00433103, 0.343868, 0.00172744, 0.137043, - 0.00623606, 0.343916, 0.00249022, 0.13709, - 0.0084868, 0.343986, 0.00339559, 0.137145, - 0.0110814, 0.344045, 0.00444687, 0.137242, - 0.0140187, 0.344177, 0.00565007, 0.137431, - 0.0172713, 0.344491, 0.00701868, 0.137644, - 0.0208605, 0.344805, 0.00856042, 0.13791, - 0.024792, 0.345172, 0.0102863, 0.138295, - 0.0290461, 0.345734, 0.0122185, 0.138764, - 0.0335957, 0.346371, 0.0143771, 0.139415, - 0.038467, 0.347298, 0.0167894, 0.140272, - 0.0436176, 0.348527, 0.0194895, 0.141457, - 0.0491016, 0.350276, 0.0225043, 0.14303, - 0.0548764, 0.352646, 0.0258962, 0.145289, - 0.0610096, 0.356206, 0.0297168, 0.148502, - 0.0674777, 0.361488, 0.0340562, 0.152188, - 0.074345, 0.367103, 0.0389534, 0.157359, - 0.0817442, 0.375247, 0.0445541, 0.16379, - 0.0896334, 0.385064, 0.0509535, 0.171376, - 0.098005, 0.396082, 0.0582611, 0.179901, - 0.106817, 0.407418, 0.06654, 0.189892, - 0.116239, 0.420031, 0.075994, 0.201838, - 0.12627, 0.434321, 0.0867239, 0.214311, - 0.136701, 0.447631, 0.0987517, 0.228902, - 0.147616, 0.462046, 0.112353, 0.245107, - 0.158871, 0.476942, 0.127605, 0.262292, - 0.170261, 0.490285, 0.144469, 0.281215, - 0.182017, 0.503783, 0.163282, 0.301058, - 0.193729, 0.515505, 0.183873, 0.322752, - 0.205512, 0.52682, 0.206466, 0.347547, - 0.217214, 0.539473, 0.231194, 0.370969, - 0.227966, 0.546625, 0.257288, 0.397533, - 0.238555, 0.55472, 0.285789, 0.42398, - 0.248278, 0.559468, 0.315746, 0.452928, - 0.257422, 0.564095, 0.347724, 0.482121, - 0.265306, 0.565426, 0.380922, 0.510438, - 0.272043, 0.563205, 0.415639, 0.541188, - 0.277614, 0.561087, 0.451702, 0.571667, - 0.281927, 0.554922, 0.48845, 0.602432, - 0.285015, 0.546838, 0.526442, 0.634126, - 0.286512, 0.537415, 0.564896, 0.662816, - 0.286388, 0.522906, 0.604037, 0.692411, - 0.284734, 0.507003, 0.643795, 0.720946, - 0.281297, 0.488398, 0.68298, 0.748293, - 0.276262, 0.466353, 0.723466, 0.776931, - 0.269978, 0.443573, 0.764565, 0.801065, - 0.260305, 0.415279, 0.805838, 0.825843, - 0.247426, 0.384773, 0.849985, 0.84807, - 0.232437, 0.352555, 0.893174, 0.869122, - 0.215806, 0.318642, 0.936564, 0.888963, - 0.197307, 0.28381, 0.980253, 0.905547, - 0.177203, 0.247888, 1.02463, 0.918554, - 0.155542, 0.212904, 1.06714, 0.931395, - 0.131948, 0.1787, 1.10451, 0.941749, - 0.106723, 0.145902, 1.13694, 0.954551, - 0.0804939, 0.111193, 1.1666, 0.970279, - 0.0534239, 0.0744697, 1.19249, 0.986117, - 0.0257452, 0.0368788, 1.21665, 0.999938, 0.00190634, - 0.0010291, 1.23981, 0.118493, - 6.47439e-06, 0.32272, 2.3772e-06, 0.118765, - 0.000163023, 0.323456, 5.98573e-05, 0.118772, - 0.00065212, 0.323477, 0.000239447, 0.118843, - 0.00146741, 0.323657, 0.000538881, 0.118804, - 0.00260846, 0.323553, 0.00095826, 0.118826, - 0.00407576, 0.323595, 0.00149845, 0.118846, - 0.00586826, 0.323617, 0.00216047, 0.118886, - 0.00798578, 0.32367, 0.00294679, 0.118947, - 0.0104273, 0.323753, 0.00386124, 0.119055, - 0.0131909, 0.323922, 0.00490999, 0.119241, - 0.0162444, 0.324251, 0.00610804, 0.11944, - 0.0196339, 0.324544, 0.00745805, 0.119739, - 0.0233378, 0.325026, 0.00897805, 0.12011, - 0.0273179, 0.325586, 0.0106895, 0.120571, - 0.0316143, 0.326231, 0.0126073, 0.12124, - 0.0361939, 0.327264, 0.0147654, 0.122162, - 0.0410511, 0.328733, 0.0172001, 0.123378, - 0.0462233, 0.330659, 0.0199375, 0.125183, - 0.0517109, 0.333754, 0.0230498, 0.127832, - 0.0575652, 0.338507, 0.026597, 0.130909, - 0.0637441, 0.343666, 0.0306345, 0.135221, - 0.0704302, 0.351063, 0.035273, 0.14082, - 0.0776364, 0.360604, 0.0406137, 0.146781, - 0.0852293, 0.369638, 0.0466788, 0.155121, - 0.0935351, 0.3827, 0.0537628, 0.16398, - 0.102234, 0.39522, 0.0617985, 0.173926, - 0.111465, 0.40793, 0.07097, 0.185137, - 0.121296, 0.42105, 0.0813426, 0.19826, - 0.13169, 0.435735, 0.0931596, 0.212938, - 0.142614, 0.450932, 0.106547, 0.229046, - 0.153884, 0.465726, 0.121575, 0.246246, - 0.165382, 0.479461, 0.138286, 0.264637, - 0.176806, 0.492106, 0.15666, 0.284959, - 0.188793, 0.504774, 0.17728, 0.308157, - 0.200763, 0.518805, 0.19988, 0.330951, - 0.21239, 0.528231, 0.224293, 0.3549, - 0.223521, 0.536376, 0.250541, 0.381502, - 0.234169, 0.544846, 0.278902, 0.409529, - 0.244077, 0.551717, 0.309227, 0.437523, - 0.253363, 0.55517, 0.341426, 0.467624, - 0.261659, 0.557772, 0.37518, 0.497268, - 0.268498, 0.556442, 0.41007, 0.528294, - 0.274018, 0.553915, 0.446445, 0.559053, - 0.278169, 0.549153, 0.483779, 0.589329, - 0.281229, 0.539878, 0.522249, 0.622503, - 0.282902, 0.53162, 0.561754, 0.652382, - 0.282815, 0.518119, 0.601544, 0.681847, - 0.281247, 0.502187, 0.641574, 0.712285, - 0.277986, 0.484824, 0.682633, 0.740094, - 0.273017, 0.463483, 0.723426, 0.768478, - 0.266692, 0.441299, 0.763747, 0.794556, - 0.258358, 0.415238, 0.805565, 0.819408, - 0.248807, 0.386912, 0.847254, 0.843411, - 0.236214, 0.356165, 0.891091, 0.862397, - 0.219794, 0.320562, 0.936174, 0.883113, - 0.201768, 0.285322, 0.982562, 0.90023, - 0.181672, 0.249713, 1.02862, 0.915192, - 0.159279, 0.214546, 1.07163, 0.928458, - 0.134725, 0.180285, 1.10995, 0.94069, - 0.10913, 0.147119, 1.14354, 0.953409, - 0.0821315, 0.112492, 1.17372, 0.969537, - 0.0542677, 0.0752014, 1.20043, 0.985612, - 0.0259096, 0.0370361, 1.22528, 0.999835, 0.00298198, - 0.00151801, 1.24959, 0.10097, - 6.02574e-06, 0.300277, 2.02619e-06, 0.101577, - 0.000152164, 0.302077, 5.11662e-05, 0.101572, - 0.000608889, 0.302066, 0.000204751, 0.101566, - 0.00136997, 0.302047, 0.000460753, 0.101592, - 0.00243557, 0.302114, 0.000819497, 0.101608, - 0.0038053, 0.30214, 0.00128154, 0.101627, - 0.00547906, 0.30216, 0.0018483, 0.101669, - 0.00745647, 0.302224, 0.00252223, 0.101732, - 0.00973615, 0.302318, 0.00330716, 0.101844, - 0.0123097, 0.302513, 0.00421061, 0.102025, - 0.0151681, 0.30285, 0.00524481, 0.102224, - 0.0183334, 0.303166, 0.0064154, 0.102515, - 0.0217819, 0.303654, 0.00774063, 0.102886, - 0.0255067, 0.304243, 0.0092398, 0.103395, - 0.029514, 0.305089, 0.0109339, 0.104109, - 0.0337912, 0.306301, 0.0128561, 0.105074, - 0.0383565, 0.30798, 0.0150338, 0.10654, - 0.0432132, 0.310726, 0.0175228, 0.108478, - 0.0484244, 0.314351, 0.0203648, 0.111015, - 0.0539339, 0.319032, 0.0236325, 0.114682, - 0.0598885, 0.32605, 0.0274188, 0.11911, - 0.0663375, 0.334109, 0.0317905, 0.124736, - 0.0733011, 0.344013, 0.0368502, 0.131479, - 0.0807744, 0.355358, 0.0427104, 0.139283, - 0.0888204, 0.367614, 0.0494788, 0.148054, - 0.0973394, 0.380072, 0.0572367, 0.159037, - 0.10665, 0.395678, 0.0662704, 0.169794, - 0.116221, 0.40795, 0.0763192, 0.18314, - 0.126632, 0.423546, 0.087956, 0.197515, - 0.137383, 0.438213, 0.101042, 0.213514, - 0.148641, 0.453248, 0.115827, 0.23065, - 0.160117, 0.46688, 0.132283, 0.249148, - 0.171807, 0.479962, 0.150644, 0.270219, - 0.183695, 0.494618, 0.171073, 0.292338, - 0.195574, 0.506937, 0.193378, 0.314999, - 0.207205, 0.516463, 0.217585, 0.340991, - 0.218955, 0.528123, 0.24428, 0.367982, - 0.229917, 0.537025, 0.272784, 0.39432, - 0.239737, 0.541627, 0.302742, 0.423364, - 0.249048, 0.546466, 0.335112, 0.453751, - 0.257329, 0.549466, 0.369032, 0.48416, - 0.264623, 0.549503, 0.404577, 0.515262, - 0.270411, 0.547008, 0.441337, 0.547036, - 0.274581, 0.542249, 0.479162, 0.576614, - 0.277266, 0.533015, 0.517904, 0.611143, - 0.279144, 0.525512, 0.558508, 0.640989, - 0.279001, 0.51154, 0.598995, 0.671182, - 0.277324, 0.495641, 0.639935, 0.700848, - 0.273908, 0.477526, 0.681017, 0.729862, - 0.269063, 0.457955, 0.722764, 0.758273, - 0.262282, 0.434846, 0.764349, 0.784121, - 0.254281, 0.409203, 0.806206, 0.809798, - 0.24505, 0.382694, 0.848617, 0.834953, - 0.233861, 0.354034, 0.892445, 0.856817, - 0.221308, 0.321764, 0.936263, 0.877609, - 0.205996, 0.288118, 0.982401, 0.897489, - 0.186702, 0.253277, 1.02975, 0.913792, - 0.164618, 0.217963, 1.07488, 0.92785, - 0.140023, 0.183221, 1.11487, 0.940378, - 0.11328, 0.149385, 1.14947, 0.95273, - 0.0853958, 0.114152, 1.1807, 0.969059, - 0.0568698, 0.0769845, 1.20912, 0.985574, - 0.0276502, 0.0381186, 1.23498, 0.999943, 0.00239052, - 0.00126861, 1.25987, 0.0852715, - 5.60067e-06, 0.279021, 1.71162e-06, 0.0854143, - 0.000140871, 0.279483, 4.30516e-05, 0.0854191, - 0.000563385, 0.2795, 0.000172184, 0.0854188, - 0.00126753, 0.279493, 0.000387464, 0.0854229, - 0.00225337, 0.279501, 0.00068918, 0.0854443, - 0.00352086, 0.279549, 0.00107803, 0.0854697, - 0.00506962, 0.279591, 0.00155536, 0.0855093, - 0.00689873, 0.279652, 0.00212354, 0.0855724, - 0.00900821, 0.279752, 0.00278703, 0.0856991, - 0.0113799, 0.280011, 0.0035551, 0.085855, - 0.0140314, 0.280297, 0.00443449, 0.0860682, - 0.016963, 0.280682, 0.00543636, 0.086344, - 0.0201438, 0.281159, 0.0065788, 0.0867426, - 0.0235999, 0.281886, 0.00787977, 0.087239, - 0.0273069, 0.282745, 0.0093606, 0.0879815, - 0.031269, 0.284139, 0.011056, 0.0891258, - 0.035531, 0.28647, 0.0130065, 0.0906909, - 0.0400947, 0.289708, 0.0152495, 0.0927624, - 0.0449638, 0.293904, 0.0178454, 0.0958376, - 0.0502427, 0.300471, 0.0208915, 0.0995827, - 0.0559514, 0.30806, 0.0244247, 0.104526, - 0.0622152, 0.317874, 0.0285721, 0.110532, - 0.0690046, 0.329332, 0.0334227, 0.117385, - 0.0763068, 0.341217, 0.0390466, 0.12522, - 0.084184, 0.353968, 0.0455786, 0.134037, - 0.0925248, 0.366797, 0.0530773, 0.144014, - 0.101487, 0.380209, 0.0617424, 0.156013, - 0.111273, 0.395956, 0.071777, 0.168872, - 0.121431, 0.41053, 0.0830905, 0.183089, - 0.132105, 0.425073, 0.0959341, 0.198763, - 0.143286, 0.439833, 0.110448, 0.216159, - 0.154841, 0.454507, 0.126769, 0.234859, - 0.166588, 0.468368, 0.14495, 0.255879, - 0.178626, 0.482846, 0.165233, 0.27677, - 0.190218, 0.493489, 0.187217, 0.301184, - 0.202227, 0.506549, 0.211659, 0.325852, - 0.213764, 0.5158, 0.237922, 0.352824, - 0.22487, 0.525442, 0.26632, 0.380882, - 0.235246, 0.532487, 0.296691, 0.410137, - 0.244847, 0.537703, 0.329179, 0.439787, - 0.253122, 0.540361, 0.363135, 0.472291, - 0.260517, 0.542734, 0.399222, 0.501856, - 0.266519, 0.538826, 0.436352, 0.534816, - 0.270905, 0.535152, 0.474505, 0.565069, - 0.273826, 0.525979, 0.513988, 0.597154, - 0.275333, 0.516394, 0.554852, 0.630473, - 0.275314, 0.506206, 0.596592, 0.660574, - 0.273323, 0.489769, 0.638117, 0.692015, - 0.270008, 0.472578, 0.680457, 0.720647, - 0.265001, 0.452134, 0.723008, 0.750528, - 0.258311, 0.430344, 0.765954, 0.777568, - 0.250046, 0.405624, 0.809012, 0.80387, - 0.240114, 0.378339, 0.852425, 0.828439, - 0.228737, 0.349877, 0.895346, 0.851472, - 0.216632, 0.318968, 0.940695, 0.873906, - 0.202782, 0.287489, 0.987235, 0.89467, - 0.187059, 0.254394, 1.03348, 0.912281, - 0.168818, 0.221294, 1.07812, 0.927358, - 0.146494, 0.18675, 1.11928, 0.940385, - 0.120009, 0.152322, 1.15609, 0.952672, - 0.0917183, 0.117514, 1.18875, 0.968496, - 0.0620321, 0.0797405, 1.21821, 0.985236, - 0.0314945, 0.0402383, 1.24523, 0.99998, - 0.000575153, 0.000110644, 1.27133, 0.0702429, - 5.12222e-06, 0.255273, 1.40947e-06, 0.0702981, - 0.000128826, 0.255469, 3.54488e-05, 0.0703691, - 0.000515562, 0.255727, 0.000141874, 0.0703805, - 0.00116, 0.255754, 0.00031929, 0.0703961, - 0.00206224, 0.255813, 0.000567999, 0.0704102, - 0.00322223, 0.255839, 0.00088871, 0.0704298, - 0.00463928, 0.255863, 0.00128272, 0.0704759, - 0.00631375, 0.255953, 0.00175283, 0.0705434, - 0.00824317, 0.256079, 0.00230342, 0.0706693, - 0.010412, 0.25636, 0.0029443, 0.0708189, - 0.0128439, 0.256647, 0.00368031, 0.0710364, - 0.0155177, 0.257084, 0.00452614, 0.0713223, - 0.0184374, 0.257637, 0.00549706, 0.0717182, - 0.0216002, 0.258416, 0.00661246, 0.072321, - 0.0249966, 0.259699, 0.00790147, 0.0731446, - 0.0286566, 0.261475, 0.0093884, 0.0743352, - 0.0325888, 0.264132, 0.0111186, 0.0760676, - 0.036843, 0.26815, 0.013145, 0.078454, - 0.0414292, 0.273636, 0.0155251, 0.0818618, - 0.0464634, 0.281653, 0.0183525, 0.0857382, - 0.0519478, 0.289992, 0.0216642, 0.0908131, - 0.0579836, 0.30066, 0.0255956, 0.0967512, - 0.0645124, 0.312204, 0.0301954, 0.103717, - 0.0716505, 0.325001, 0.0356017, 0.111596, - 0.0793232, 0.338129, 0.041896, 0.120933, - 0.087645, 0.352853, 0.0492447, 0.130787, - 0.096492, 0.366192, 0.0576749, 0.142311, - 0.105973, 0.380864, 0.0673969, 0.155344, - 0.116182, 0.396575, 0.0785899, 0.169535, - 0.126815, 0.411443, 0.0912377, 0.185173, - 0.138015, 0.426256, 0.105607, 0.201755, - 0.149325, 0.439607, 0.121551, 0.221334, - 0.161207, 0.455467, 0.139608, 0.241461, - 0.173162, 0.469096, 0.159591, 0.26294, - 0.18504, 0.481014, 0.18156, 0.286776, - 0.196881, 0.493291, 0.205781, 0.311596, - 0.208311, 0.503556, 0.231819, 0.338667, - 0.219671, 0.513268, 0.260274, 0.366021, - 0.230451, 0.519414, 0.290862, 0.395875, - 0.240131, 0.526766, 0.323196, 0.425564, - 0.248566, 0.52905, 0.357071, 0.457094, - 0.256195, 0.530796, 0.393262, 0.488286, - 0.262331, 0.528703, 0.430797, 0.522291, - 0.267141, 0.52727, 0.470231, 0.554172, - 0.270411, 0.519848, 0.510477, 0.586427, - 0.271986, 0.510307, 0.551594, 0.619638, - 0.27192, 0.499158, 0.593849, 0.650656, - 0.269817, 0.483852, 0.636314, 0.68284, - 0.266267, 0.467515, 0.679679, 0.714356, - 0.26113, 0.44931, 0.723884, 0.742717, - 0.254067, 0.425789, 0.767245, 0.770894, - 0.245652, 0.401144, 0.811819, 0.797358, - 0.235554, 0.374224, 0.856315, 0.823377, - 0.223896, 0.346167, 0.901077, 0.847456, - 0.210865, 0.316056, 0.946502, 0.870697, - 0.196574, 0.284503, 0.993711, 0.891068, - 0.180814, 0.251628, 1.04134, 0.909267, - 0.163314, 0.219065, 1.08609, 0.925653, - 0.143304, 0.186446, 1.12702, 0.940017, - 0.121322, 0.153416, 1.16371, 0.952398, - 0.0973872, 0.120334, 1.19712, 0.967568, - 0.0698785, 0.08352, 1.22791, 0.984772, - 0.0390031, 0.0439209, 1.25672, 1.00026, - 0.0070087, 0.00315668, 1.28428, 0.0556653, - 4.59654e-06, 0.227325, 1.12556e-06, 0.0565238, - 0.000116382, 0.230826, 2.84985e-05, 0.0565717, - 0.000465666, 0.231026, 0.000114036, 0.0565859, - 0.00104773, 0.231079, 0.000256656, 0.0565761, - 0.00186255, 0.231025, 0.00045663, 0.0565913, - 0.00291002, 0.231058, 0.000714664, 0.0566108, - 0.00418998, 0.231085, 0.00103224, 0.0566532, - 0.00570206, 0.231169, 0.00141202, 0.0567473, - 0.00743666, 0.231417, 0.00186018, 0.0568567, - 0.00940298, 0.231661, 0.00238264, 0.0569859, - 0.0115991, 0.231895, 0.00298699, 0.0572221, - 0.0140096, 0.232456, 0.00368957, 0.057519, - 0.0166508, 0.233096, 0.00450303, 0.0579534, - 0.01951, 0.234094, 0.00544945, 0.0585922, - 0.0225991, 0.235629, 0.00655564, 0.0595647, - 0.0259416, 0.238106, 0.00785724, 0.0609109, - 0.0295661, 0.241557, 0.00939127, 0.0628751, - 0.0335126, 0.246652, 0.0112198, 0.0656908, - 0.0378604, 0.254091, 0.0134168, 0.0691347, - 0.0426543, 0.262666, 0.0160374, 0.0732165, - 0.0478967, 0.272029, 0.0191514, 0.0782863, - 0.0536716, 0.283007, 0.0228597, 0.0843973, - 0.0600683, 0.295732, 0.0272829, 0.0913598, - 0.0670095, 0.308779, 0.032484, 0.0994407, - 0.0745516, 0.322886, 0.0385886, 0.108189, - 0.082712, 0.336408, 0.0457133, 0.118574, - 0.0914927, 0.351692, 0.0539832, 0.129989, - 0.100854, 0.366502, 0.0635162, 0.142722, - 0.110837, 0.381675, 0.0744386, 0.156654, - 0.121353, 0.3963, 0.0868483, 0.172151, - 0.132414, 0.411477, 0.100963, 0.188712, - 0.143809, 0.42508, 0.116795, 0.208093, - 0.155765, 0.441328, 0.134715, 0.227936, - 0.167608, 0.454328, 0.154396, 0.249495, - 0.179579, 0.467235, 0.176179, 0.27362, - 0.191488, 0.480248, 0.200193, 0.296371, - 0.202618, 0.487886, 0.225775, 0.324234, - 0.214133, 0.499632, 0.25441, 0.353049, - 0.225212, 0.509532, 0.285077, 0.381785, - 0.234875, 0.514265, 0.317047, 0.414038, - 0.244205, 0.521282, 0.351874, 0.445251, - 0.252145, 0.522931, 0.388279, 0.476819, - 0.258433, 0.520947, 0.425825, 0.509209, - 0.263411, 0.517669, 0.465104, 0.542759, - 0.266732, 0.512841, 0.505741, 0.574822, - 0.268263, 0.503317, 0.547611, 0.609324, - 0.268489, 0.493035, 0.590953, 0.641772, - 0.266941, 0.478816, 0.63488, 0.674049, - 0.263297, 0.462863, 0.679072, 0.705071, - 0.257618, 0.442931, 0.723487, 0.734709, - 0.250625, 0.421299, 0.768708, 0.763704, - 0.24179, 0.397085, 0.814375, 0.791818, - 0.231115, 0.370577, 0.859907, 0.817439, - 0.21922, 0.34232, 0.906715, 0.843202, - 0.205658, 0.312627, 0.953943, 0.866639, - 0.190563, 0.280933, 1.00185, 0.888129, - 0.173978, 0.248393, 1.05105, 0.907239, - 0.155485, 0.216007, 1.09704, 0.923893, - 0.134782, 0.183233, 1.13857, 0.938882, - 0.11249, 0.150376, 1.17539, 0.952464, - 0.0890706, 0.117177, 1.20924, 0.968529, - 0.0646523, 0.0813095, 1.24055, 0.984763, - 0.038606, 0.0439378, 1.27018, 1.00053, - 0.01238, 0.00598668, 1.29873, 0.0437928, - 4.09594e-06, 0.204012, 8.79224e-07, 0.0440166, - 0.000103395, 0.205049, 2.21946e-05, 0.0440529, - 0.000413633, 0.205225, 8.87981e-05, 0.0440493, - 0.000930594, 0.2052, 0.000199858, 0.0439884, - 0.00165352, 0.204901, 0.000355495, 0.0440716, - 0.0025849, 0.205255, 0.000556983, 0.0440968, - 0.00372222, 0.205311, 0.000805326, 0.0441359, - 0.00506478, 0.205391, 0.00110333, 0.0442231, - 0.00660384, 0.205638, 0.00145768, 0.0443254, - 0.00835246, 0.205877, 0.00187275, 0.0444832, - 0.0102992, 0.20627, 0.00235938, 0.0447001, - 0.0124449, 0.206796, 0.0029299, 0.0450168, - 0.0147935, 0.207593, 0.0036005, 0.0454816, - 0.017336, 0.208819, 0.00439246, 0.0462446, - 0.0201156, 0.211036, 0.00533864, 0.0473694, - 0.0231568, 0.214388, 0.00646984, 0.0490191, - 0.0264941, 0.219357, 0.00783856, 0.0512776, - 0.030184, 0.226061, 0.00950182, 0.0541279, - 0.0342661, 0.234094, 0.0115156, 0.0578989, - 0.0388539, 0.244297, 0.0139687, 0.0620835, - 0.0438735, 0.254457, 0.0169015, 0.0673497, - 0.04951, 0.266706, 0.0204554, 0.0731759, - 0.0556263, 0.278753, 0.0246606, 0.0803937, - 0.0624585, 0.29309, 0.0297126, 0.0879287, - 0.0697556, 0.305856, 0.0355868, 0.0970669, - 0.0778795, 0.321059, 0.0425768, 0.106508, - 0.0863541, 0.333873, 0.05056, 0.11776, - 0.0955935, 0.349008, 0.0598972, 0.130081, - 0.105438, 0.363776, 0.0706314, 0.144454, - 0.115899, 0.380112, 0.0828822, 0.1596, - 0.126827, 0.394843, 0.0967611, 0.176097, - 0.138161, 0.409033, 0.112381, 0.194726, - 0.149904, 0.424257, 0.129952, 0.213944, - 0.161675, 0.436945, 0.149333, 0.235516, - 0.173659, 0.450176, 0.170892, 0.260564, - 0.185963, 0.466305, 0.194984, 0.285183, - 0.197582, 0.477328, 0.220805, 0.311095, - 0.208697, 0.486566, 0.248694, 0.338924, - 0.219519, 0.494811, 0.279015, 0.369757, - 0.229766, 0.504065, 0.311725, 0.3996, - 0.238879, 0.507909, 0.345844, 0.430484, - 0.246802, 0.509805, 0.381749, 0.46413, - 0.253924, 0.511436, 0.420251, 0.497077, - 0.259319, 0.508787, 0.459957, 0.530434, - 0.263297, 0.50394, 0.501356, 0.565725, - 0.265619, 0.49804, 0.544252, 0.599254, - 0.265842, 0.487346, 0.587856, 0.631251, - 0.263978, 0.472975, 0.631969, 0.663972, - 0.26043, 0.457135, 0.677471, 0.697724, - 0.255358, 0.439844, 0.723744, 0.727725, - 0.248308, 0.417872, 0.770653, 0.756417, - 0.239181, 0.39273, 0.817357, 0.785419, - 0.22814, 0.367839, 0.864221, 0.81266, - 0.215681, 0.339449, 0.912701, 0.839391, - 0.201623, 0.309279, 0.962419, 0.86366, - 0.185624, 0.278029, 1.0122, 0.885028, - 0.16797, 0.245294, 1.06186, 0.904639, - 0.148336, 0.212689, 1.10934, 0.922048, - 0.12637, 0.179616, 1.15063, 0.936952, - 0.102928, 0.146749, 1.18885, 0.951895, - 0.0785268, 0.112733, 1.22352, 0.967198, - 0.0530153, 0.0760056, 1.25681, 0.984405, - 0.02649, 0.0383183, 1.28762, 1.00021, 0.00070019, - 0.00020039, 1.31656, 0.0325964, - 3.55447e-06, 0.176706, 6.55682e-07, 0.0329333, - 8.99174e-05, 0.178527, 1.65869e-05, 0.0329181, - 0.000359637, 0.178453, 6.63498e-05, 0.0329085, - 0.000808991, 0.178383, 0.000149332, 0.0329181, - 0.00143826, 0.178394, 0.000265873, 0.0329425, - 0.00224678, 0.178517, 0.000416597, 0.0329511, - 0.00323575, 0.17849, 0.000603299, 0.033011, - 0.00439875, 0.178695, 0.000829422, 0.0330733, - 0.00574059, 0.178843, 0.00109908, 0.0331857, - 0.00725896, 0.179176, 0.00141933, 0.0333445, - 0.00895289, 0.179618, 0.0017999, 0.0335674, - 0.0108219, 0.180238, 0.00225316, 0.033939, - 0.0128687, 0.181417, 0.00279765, 0.0345239, - 0.015114, 0.183395, 0.0034564, 0.0354458, - 0.017596, 0.186616, 0.00425864, 0.0368313, - 0.0203524, 0.191547, 0.00524936, 0.0386115, - 0.0234105, 0.197508, 0.00647033, 0.0410303, - 0.0268509, 0.205395, 0.00798121, 0.0442245, - 0.0307481, 0.215365, 0.0098557, 0.0478659, - 0.0350863, 0.225595, 0.0121417, 0.0522416, - 0.0399506, 0.236946, 0.0149385, 0.0574513, - 0.045357, 0.249442, 0.0183189, 0.0631208, - 0.0512863, 0.261222, 0.0223644, 0.0701124, - 0.0579273, 0.275418, 0.0272418, 0.0777331, - 0.0650652, 0.288989, 0.0329458, 0.0862709, - 0.0728813, 0.302546, 0.0396819, 0.096103, - 0.081363, 0.317164, 0.04757, 0.106976, - 0.0904463, 0.331733, 0.0567012, 0.119175, - 0.100105, 0.34661, 0.067202, 0.132919, - 0.110375, 0.362249, 0.0792588, 0.147727, - 0.121115, 0.376978, 0.0928672, 0.163618, - 0.132299, 0.390681, 0.108228, 0.182234, - 0.143887, 0.406571, 0.125502, 0.201809, - 0.155827, 0.42042, 0.144836, 0.225041, - 0.168357, 0.438411, 0.166706, 0.247621, - 0.18004, 0.450368, 0.189909, 0.27097, - 0.191536, 0.460083, 0.215251, 0.296658, - 0.203024, 0.469765, 0.243164, 0.325892, - 0.214056, 0.481837, 0.273388, 0.35406, - 0.224104, 0.487474, 0.305344, 0.384372, - 0.233489, 0.492773, 0.339741, 0.41749, - 0.241874, 0.498451, 0.376287, 0.45013, - 0.248834, 0.499632, 0.414195, 0.481285, - 0.254658, 0.495233, 0.454077, 0.519183, - 0.259367, 0.496401, 0.496352, 0.551544, - 0.261818, 0.487686, 0.538798, 0.587349, - 0.262964, 0.479453, 0.583626, 0.621679, - 0.262128, 0.467709, 0.629451, 0.654991, - 0.258998, 0.452123, 0.67566, 0.686873, - 0.254119, 0.433495, 0.723248, 0.719801, - 0.246946, 0.413657, 0.771156, 0.750355, - 0.237709, 0.390366, 0.81989, 0.780033, - 0.226549, 0.364947, 0.868601, 0.809254, - 0.214186, 0.337256, 0.920034, 0.836576, - 0.199639, 0.307395, 0.971706, 0.861774, - 0.183169, 0.275431, 1.02479, 0.885707, - 0.165111, 0.243431, 1.07837, 0.904742, - 0.144363, 0.210921, 1.12783, 0.915604, - 0.121305, 0.17647, 1.17254, 0.930959, - 0.0962119, 0.143106, 1.21012, 0.948404, - 0.069969, 0.108112, 1.24474, 0.967012, - 0.0427586, 0.0708478, 1.27718, 0.984183, - 0.0147043, 0.032335, 1.3083, 0.999577, 0.0142165, - 0.00726867, 1.3382, 0.0229227, - 2.99799e-06, 0.148623, 4.62391e-07, 0.0232194, - 7.58796e-05, 0.15054, 1.17033e-05, 0.0232315, - 0.000303636, 0.15063, 4.68397e-05, 0.0232354, - 0.000683189, 0.150624, 0.000105472, 0.0232092, - 0.0012136, 0.150445, 0.000187744, 0.0232523, - 0.00189765, 0.150679, 0.000294847, 0.0232828, - 0.00273247, 0.150789, 0.000428013, 0.0233371, - 0.00371287, 0.150995, 0.000591134, 0.0234015, - 0.00484794, 0.15118, 0.000787642, 0.023514, - 0.00612877, 0.151562, 0.00102547, 0.023679, - 0.00756125, 0.152116, 0.00131351, 0.0239559, - 0.00914651, 0.153162, 0.00166594, 0.0244334, - 0.010904, 0.155133, 0.00210182, 0.025139, - 0.0128615, 0.158035, 0.00264406, 0.0262598, - 0.0150628, 0.162751, 0.00332923, 0.0277875, - 0.0175532, 0.168944, 0.00419773, 0.0298472, - 0.0203981, 0.176835, 0.00530034, 0.0325444, - 0.023655, 0.186686, 0.00669777, 0.0355581, - 0.0272982, 0.196248, 0.00842661, 0.0392841, - 0.0314457, 0.207352, 0.0105854, 0.0436815, - 0.0361157, 0.219279, 0.0132458, 0.0485272, - 0.0412932, 0.230728, 0.0164736, 0.0541574, - 0.0470337, 0.242994, 0.0203715, 0.0609479, - 0.0535002, 0.257042, 0.0250953, 0.0685228, - 0.0605409, 0.27102, 0.0306856, 0.0768042, - 0.0680553, 0.28406, 0.037193, 0.0864844, - 0.0765011, 0.299186, 0.0449795, 0.0969415, - 0.0852674, 0.3132, 0.0538316, 0.108478, - 0.0947333, 0.327138, 0.0641149, 0.121705, - 0.10481, 0.342345, 0.0759185, 0.136743, - 0.115474, 0.358472, 0.0894116, 0.152986, - 0.126536, 0.374067, 0.104562, 0.170397, - 0.138061, 0.388267, 0.121632, 0.191392, - 0.150203, 0.406467, 0.140996, 0.211566, - 0.161751, 0.418641, 0.161696, 0.233567, - 0.173407, 0.430418, 0.184557, 0.257769, - 0.185397, 0.44277, 0.210092, 0.28531, - 0.197048, 0.457191, 0.237827, 0.311726, - 0.20784, 0.464712, 0.267253, 0.340537, - 0.218345, 0.472539, 0.299332, 0.372921, - 0.228306, 0.482331, 0.333988, 0.402924, - 0.236665, 0.484378, 0.369722, 0.434475, - 0.244097, 0.484717, 0.407836, 0.469736, - 0.250547, 0.487093, 0.448465, 0.505045, - 0.25511, 0.485575, 0.490263, 0.540262, - 0.258444, 0.481225, 0.534495, 0.576347, - 0.259903, 0.473481, 0.579451, 0.608656, - 0.259572, 0.4603, 0.625604, 0.646679, - 0.257908, 0.450341, 0.674511, 0.679902, - 0.253663, 0.431561, 0.723269, 0.714159, - 0.247419, 0.412684, 0.773263, 0.745345, - 0.239122, 0.389388, 0.824182, 0.778248, - 0.228837, 0.365361, 0.876634, 0.807208, - 0.216197, 0.337667, 0.92945, 0.835019, - 0.201772, 0.307197, 0.985261, 0.860261, - 0.185291, 0.274205, 1.04299, 0.877601, - 0.165809, 0.240178, 1.09816, 0.898211, - 0.143897, 0.207571, 1.14694, 0.915789, - 0.119513, 0.174904, 1.19008, 0.931831, - 0.0932919, 0.141423, 1.2297, 0.949244, - 0.0656528, 0.105603, 1.26553, 0.967527, - 0.0370262, 0.0679551, 1.29986, 0.984139, - 0.00730117, 0.0283133, 1.33252, 0.999713, 0.0234648, - 0.0121785, 1.36397, 0.0152135, - 2.45447e-06, 0.122795, 3.04092e-07, 0.0151652, - 6.15778e-05, 0.122399, 7.6292e-06, 0.0151181, - 0.000245948, 0.122023, 3.04802e-05, 0.0151203, - 0.000553394, 0.12203, 6.86634e-05, 0.015125, - 0.000983841, 0.122037, 0.000122463, 0.0151427, - 0.00153774, 0.12214, 0.000192706, 0.0151708, - 0.0022103, 0.122237, 0.000281219, 0.0152115, - 0.00300741, 0.12238, 0.000390804, 0.0152877, - 0.00392494, 0.1227, 0.000526317, 0.015412, - 0.00496597, 0.123244, 0.00069443, 0.0156201, - 0.00613314, 0.124228, 0.00090547, 0.0159658, - 0.00744113, 0.125945, 0.0011732, 0.0165674, - 0.00892546, 0.129098, 0.00151888, 0.017487, - 0.010627, 0.133865, 0.00197007, 0.018839, - 0.0126043, 0.140682, 0.0025637, 0.020554, - 0.0148814, 0.148534, 0.00333637, 0.0226727, - 0.0175123, 0.157381, 0.00433738, 0.0251879, - 0.0205266, 0.166685, 0.00561664, 0.0283635, - 0.0240319, 0.177796, 0.00725563, 0.0318694, - 0.0279432, 0.188251, 0.00928811, 0.0361044, - 0.0324313, 0.200038, 0.011835, 0.0406656, - 0.0373527, 0.210685, 0.0149146, 0.0463846, - 0.0430132, 0.224182, 0.0187254, 0.0525696, - 0.0491013, 0.23634, 0.0232283, 0.0598083, - 0.0559175, 0.250013, 0.0286521, 0.0679437, - 0.0633657, 0.263981, 0.0350634, 0.0771181, - 0.0714602, 0.278072, 0.0425882, 0.0881273, - 0.0803502, 0.29511, 0.0514487, 0.0996628, - 0.0896903, 0.309976, 0.0615766, 0.112702, - 0.099644, 0.325611, 0.0732139, 0.126488, - 0.109829, 0.339321, 0.0862324, 0.142625, - 0.120859, 0.35574, 0.101275, 0.15953, - 0.131956, 0.369845, 0.117892, 0.176991, - 0.143145, 0.38146, 0.136205, 0.199715, - 0.155292, 0.40052, 0.157252, 0.220787, - 0.167066, 0.412055, 0.179966, 0.243697, - 0.178396, 0.423133, 0.204418, 0.272106, - 0.190433, 0.439524, 0.232141, 0.297637, - 0.201265, 0.447041, 0.261109, 0.325273, - 0.211834, 0.454488, 0.292627, 0.357219, - 0.221889, 0.465004, 0.326669, 0.387362, - 0.230729, 0.468527, 0.362426, 0.423131, - 0.23924, 0.475836, 0.401533, 0.45543, - 0.246067, 0.475017, 0.441902, 0.493393, - 0.251557, 0.478017, 0.484239, 0.526253, - 0.255571, 0.4709, 0.528586, 0.560554, - 0.257752, 0.463167, 0.574346, 0.599306, - 0.258076, 0.456452, 0.621655, 0.634541, - 0.256471, 0.443725, 0.670492, 0.668907, - 0.253283, 0.428719, 0.721943, 0.705619, - 0.247562, 0.411348, 0.772477, 0.739034, - 0.240626, 0.388939, 0.8264, 0.771408, - 0.231493, 0.36425, 0.881702, 0.803312, - 0.220125, 0.337321, 0.9385, 0.828457, - 0.206645, 0.305364, 0.997437, 0.854819, - 0.190664, 0.273715, 1.05693, 0.878666, - 0.171429, 0.242218, 1.11251, 0.898404, - 0.149235, 0.209556, 1.16398, 0.917416, - 0.12435, 0.176863, 1.21014, 0.933133, - 0.0972703, 0.142775, 1.25178, 0.95066, - 0.0683607, 0.106735, 1.29028, 0.968589, - 0.0378724, 0.0681609, 1.32703, 0.984776, - 0.00605712, 0.0273966, 1.36158, 0.99994, 0.0263276, - 0.0138124, 1.3943, 0.00867437, - 1.86005e-06, 0.0928979, 1.73682e-07, 0.00864003, - 4.66389e-05, 0.0925237, 4.35505e-06, 0.00864593, - 0.000186594, 0.0925806, 1.74322e-05, 0.00864095, - 0.000419639, 0.0924903, 3.92862e-05, 0.00863851, - 0.000746272, 0.0924589, 7.02598e-05, 0.00868531, - 0.00116456, 0.0929, 0.000111188, 0.00869667, - 0.00167711, 0.0928529, 0.000163867, 0.00874332, - 0.00228051, 0.0930914, 0.00023104, 0.00882709, - 0.00297864, 0.0935679, 0.00031741, 0.00898874, - 0.00377557, 0.0946165, 0.000430186, 0.00929346, - 0.00469247, 0.0967406, 0.000580383, 0.00978271, - 0.00575491, 0.100084, 0.000783529, 0.0105746, - 0.00701514, 0.105447, 0.00106304, 0.0116949, - 0.00851797, 0.112494, 0.00144685, 0.0130419, - 0.0102757, 0.119876, 0.00196439, 0.0148375, - 0.012381, 0.129034, 0.00266433, 0.0168725, - 0.01482, 0.137812, 0.00358364, 0.0193689, - 0.0176563, 0.147696, 0.00478132, 0.0222691, - 0.0209211, 0.157795, 0.00631721, 0.0256891, - 0.0246655, 0.168431, 0.00826346, 0.0294686, - 0.0288597, 0.178587, 0.0106714, 0.0340412, - 0.0336441, 0.190251, 0.0136629, 0.0393918, - 0.039033, 0.202999, 0.0173272, 0.0453947, - 0.0450087, 0.215655, 0.0217448, 0.0521936, - 0.0515461, 0.228686, 0.0269941, 0.0600279, - 0.058817, 0.242838, 0.033272, 0.0692398, - 0.0667228, 0.258145, 0.0406457, 0.0793832, - 0.0752401, 0.273565, 0.0492239, 0.0902297, - 0.0841851, 0.287735, 0.0590105, 0.102014, - 0.0936479, 0.301161, 0.0702021, 0.116054, - 0.103967, 0.317438, 0.0832001, 0.13191, - 0.114622, 0.334166, 0.0977951, 0.148239, - 0.125452, 0.348192, 0.113985, 0.165809, - 0.136453, 0.361094, 0.131928, 0.184616, - 0.147648, 0.373534, 0.151811, 0.207491, - 0.159607, 0.39101, 0.174476, 0.230106, - 0.171119, 0.402504, 0.198798, 0.257036, - 0.182906, 0.418032, 0.225796, 0.281172, - 0.193605, 0.425468, 0.254027, 0.312034, - 0.204771, 0.440379, 0.285713, 0.340402, - 0.214988, 0.445406, 0.319196, 0.370231, - 0.224711, 0.44968, 0.35537, 0.407105, - 0.233516, 0.460747, 0.393838, 0.439037, - 0.240801, 0.460624, 0.433747, 0.47781, - 0.24762, 0.465957, 0.477234, 0.510655, - 0.251823, 0.460054, 0.52044, 0.550584, - 0.255552, 0.459172, 0.567853, 0.585872, - 0.257036, 0.450311, 0.615943, 0.620466, - 0.257535, 0.437763, 0.667693, 0.660496, - 0.255248, 0.426639, 0.718988, 0.695578, - 0.251141, 0.409185, 0.772503, 0.732176, - 0.244718, 0.39015, 0.827023, 0.760782, - 0.236782, 0.362594, 0.885651, 0.79422, - 0.225923, 0.33711, 0.943756, 0.824521, - 0.213855, 0.308272, 1.00874, 0.854964, - 0.197723, 0.278529, 1.06764, 0.878065, - 0.179209, 0.246208, 1.12836, 0.899834, - 0.157569, 0.21329, 1.18318, 0.918815, - 0.133206, 0.181038, 1.23161, 0.934934, - 0.106545, 0.146993, 1.27644, 0.952115, - 0.0780574, 0.111175, 1.31842, 0.96906, - 0.0478279, 0.0728553, 1.35839, 0.985178, - 0.0160014, 0.032579, 1.39697, 1.00039, 0.0173126, - 0.0095256, 1.43312, 0.00384146, - 1.24311e-06, 0.0613583, 7.78271e-08, 0.00390023, - 3.14043e-05, 0.0622919, 1.96626e-06, 0.00389971, - 0.000125622, 0.0622632, 7.87379e-06, 0.00389491, - 0.000282352, 0.0620659, 1.778e-05, 0.00391618, - 0.000502512, 0.0624687, 3.20918e-05, 0.00392662, - 0.000784458, 0.0625113, 5.15573e-05, 0.00396053, - 0.00112907, 0.0628175, 7.78668e-05, 0.00401911, - 0.00153821, 0.0633286, 0.000113811, 0.00414994, - 0.0020208, 0.0646443, 0.00016445, 0.00441223, - 0.00260007, 0.0673886, 0.000237734, 0.00484427, - 0.0033097, 0.0716528, 0.000345929, 0.00549109, - 0.00418966, 0.0774998, 0.000505987, 0.00636293, - 0.00527331, 0.0844758, 0.000739208, 0.00746566, - 0.00660428, 0.0921325, 0.00107347, 0.00876625, - 0.00818826, 0.0997067, 0.00153691, 0.0103125, - 0.0100811, 0.107433, 0.00217153, 0.0123309, - 0.0123643, 0.117088, 0.00303427, 0.0146274, - 0.0150007, 0.126438, 0.00416018, 0.0172295, - 0.0180531, 0.135672, 0.00561513, 0.0204248, - 0.0215962, 0.146244, 0.007478, 0.0241597, - 0.0256234, 0.157481, 0.00981046, 0.0284693, - 0.0302209, 0.169125, 0.0127148, 0.033445, - 0.0353333, 0.181659, 0.0162453, 0.0391251, - 0.0410845, 0.1944, 0.0205417, 0.0454721, - 0.0473451, 0.207082, 0.0256333, 0.0530983, - 0.0542858, 0.221656, 0.0317036, 0.0615356, - 0.0618384, 0.236036, 0.0388319, 0.0703363, - 0.0697631, 0.248398, 0.046974, 0.0810391, - 0.0784757, 0.263611, 0.0565246, 0.0920144, - 0.0873488, 0.275857, 0.0671724, 0.105584, - 0.0973652, 0.292555, 0.0798105, 0.119506, - 0.107271, 0.306333, 0.0935945, 0.134434, - 0.117608, 0.318888, 0.109106, 0.153399, - 0.128938, 0.337552, 0.127074, 0.171258, - 0.139944, 0.349955, 0.14643, 0.191059, - 0.151288, 0.361545, 0.168, 0.215069, - 0.163018, 0.378421, 0.192082, 0.237838, - 0.174226, 0.38879, 0.217838, 0.266965, - 0.186063, 0.405857, 0.246931, 0.292827, - 0.196909, 0.414146, 0.277505, 0.324352, - 0.207473, 0.426955, 0.310711, 0.354427, - 0.217713, 0.433429, 0.346794, 0.389854, - 0.227183, 0.443966, 0.385237, 0.420749, - 0.235131, 0.44471, 0.424955, 0.459597, - 0.242786, 0.451729, 0.468446, 0.495316, - 0.248767, 0.45072, 0.513422, 0.534903, - 0.253351, 0.450924, 0.560618, 0.572369, - 0.256277, 0.445266, 0.609677, 0.612383, - 0.2576, 0.438798, 0.660995, 0.644037, - 0.256931, 0.421693, 0.713807, 0.686749, - 0.254036, 0.4109, 0.767616, 0.719814, - 0.249785, 0.390151, 0.82533, 0.754719, - 0.244283, 0.367847, 0.888311, 0.792022, - 0.235076, 0.345013, 0.948177, 0.822404, - 0.225061, 0.316193, 1.01661, 0.853084, - 0.211113, 0.287013, 1.08075, 0.879871, - 0.19449, 0.255424, 1.14501, 0.901655, - 0.174023, 0.222879, 1.20203, 0.919957, - 0.1509, 0.18989, 1.25698, 0.938412, - 0.124923, 0.15606, 1.30588, 0.953471, - 0.0968139, 0.120512, 1.3529, 0.970451, - 0.066734, 0.0828515, 1.3986, 0.985522, - 0.034734, 0.0424458, 1.44148, 1.00099, - 0.00102222, 0.000678929, 1.48398, 0.000965494, - 6.27338e-07, 0.0306409, 1.97672e-08, 0.00099168, - 1.58573e-05, 0.0314638, 4.99803e-07, 0.000991068, - 6.34012e-05, 0.031363, 2.00682e-06, 0.000974567, - 0.00014144, 0.03036, 4.57312e-06, 0.000998079, - 0.000252812, 0.031496, 8.60131e-06, 0.00102243, - 0.000396506, 0.0319955, 1.48288e-05, 0.00107877, - 0.000577593, 0.0331376, 2.49141e-05, 0.00121622, - 0.000816816, 0.0359396, 4.23011e-05, 0.0014455, - 0.00113761, 0.0399652, 7.24613e-05, 0.00178791, - 0.00156959, 0.0450556, 0.000123929, 0.00225668, - 0.00214064, 0.0508025, 0.000208531, 0.00285627, - 0.00287655, 0.0568443, 0.000341969, 0.0035991, - 0.00380271, 0.0630892, 0.000544158, 0.00455524, - 0.00496264, 0.0702204, 0.000842423, 0.00569143, - 0.0063793, 0.0773426, 0.00126704, 0.00716928, - 0.00813531, 0.0860839, 0.00186642, 0.00885307, - 0.0101946, 0.0944079, 0.00267014, 0.0109316, - 0.0126386, 0.103951, 0.00374033, 0.0133704, - 0.0154876, 0.113786, 0.0051304, 0.0161525, - 0.0187317, 0.123477, 0.00688858, 0.0194267, - 0.0224652, 0.133986, 0.00910557, 0.0230967, - 0.0265976, 0.143979, 0.0118074, 0.0273627, - 0.0312848, 0.154645, 0.0151266, 0.0323898, - 0.0365949, 0.166765, 0.0191791, 0.0379225, - 0.0422914, 0.177932, 0.0239236, 0.0447501, - 0.0487469, 0.19167, 0.0296568, 0.0519391, - 0.0556398, 0.203224, 0.0362924, 0.0599464, - 0.0631646, 0.215652, 0.0440585, 0.0702427, - 0.0714308, 0.232089, 0.0531619, 0.0806902, - 0.0800605, 0.245258, 0.0634564, 0.0923194, - 0.0892815, 0.258609, 0.0752481, 0.106938, - 0.09931, 0.276654, 0.0888914, 0.121238, - 0.109575, 0.289847, 0.104055, 0.138817, - 0.120461, 0.307566, 0.121266, 0.15595, - 0.131209, 0.320117, 0.139944, 0.178418, - 0.143049, 0.339677, 0.161591, 0.197875, - 0.154074, 0.349886, 0.184303, 0.224368, - 0.166307, 0.369352, 0.210669, 0.252213, - 0.178051, 0.386242, 0.238895, 0.277321, - 0.189335, 0.395294, 0.269182, 0.310332, - 0.200683, 0.412148, 0.302508, 0.338809, - 0.210856, 0.418266, 0.337264, 0.372678, - 0.220655, 0.428723, 0.374881, 0.405632, - 0.230053, 0.433887, 0.415656, 0.442293, - 0.237993, 0.439911, 0.457982, 0.477256, - 0.244897, 0.440175, 0.502831, 0.515592, - 0.250657, 0.441079, 0.550277, 0.550969, - 0.255459, 0.435219, 0.601102, 0.592883, - 0.257696, 0.432882, 0.651785, 0.629092, - 0.259894, 0.421054, 0.708961, 0.672033, - 0.258592, 0.41177, 0.763806, 0.709147, - 0.256525, 0.395267, 0.824249, 0.745367, - 0.254677, 0.375013, 0.8951, 0.784715, - 0.247892, 0.353906, 0.959317, 0.818107, - 0.240162, 0.327801, 1.03153, 0.847895, - 0.229741, 0.298821, 1.10601, 0.879603, - 0.213084, 0.269115, 1.164, 0.902605, - 0.195242, 0.236606, 1.22854, 0.922788, - 0.174505, 0.203442, 1.29017, 0.944831, - 0.150169, 0.169594, 1.34157, 0.959656, - 0.124099, 0.135909, 1.3956, 0.972399, - 0.0960626, 0.0990563, 1.45128, 0.986549, - 0.0657097, 0.0602348, 1.50312, 1.00013, - 0.0333558, 0.0186694, 1.55364, 6.19747e-06, - 1e-07, 0.00778326, 7.96756e-11, 2.37499e-08, - 9.99999e-08, 2.82592e-05, 1.14596e-10, 1.00292e-06, - 1.66369e-06, 0.000250354, 6.77492e-09, 3.50752e-06, - 6.37769e-06, 0.000357289, 6.31655e-08, 8.26445e-06, - 1.74689e-05, 0.000516179, 3.1851e-07, 2.42481e-05, - 4.50868e-05, 0.0010223, 1.30577e-06, 4.55631e-05, - 8.9044e-05, 0.00144302, 3.74587e-06, 9.71222e-05, - 0.000178311, 0.00241912, 1.02584e-05, 0.000171403, - 0.000313976, 0.00354938, 2.36481e-05, 0.000292747, - 0.000520026, 0.00513765, 4.96014e-05, 0.000789827, - 0.00118187, 0.0238621, 0.000139056, 0.00114093, - 0.00171827, 0.0286691, 0.000244093, 0.00176119, - 0.00249667, 0.0368565, 0.000420623, 0.0022233, - 0.00333742, 0.0400469, 0.00065673, 0.00343382, - 0.00481976, 0.0535751, 0.00109323, 0.00427602, - 0.00600755, 0.057099, 0.00155268, 0.00461435, - 0.00737637, 0.0551084, 0.00215031, 0.00695698, - 0.00971401, 0.0715767, 0.00316529, 0.00867619, - 0.0120943, 0.0793314, 0.00436995, 0.0106694, - 0.0148202, 0.0869391, 0.0058959, 0.0140351, - 0.0183501, 0.101572, 0.00798757, 0.0168939, - 0.022006, 0.11018, 0.0104233, 0.020197, - 0.0261568, 0.119041, 0.0134167, 0.0254702, - 0.0312778, 0.135404, 0.0173009, 0.0298384, - 0.0362469, 0.1437, 0.0215428, 0.035159, - 0.042237, 0.15512, 0.0268882, 0.0427685, - 0.0488711, 0.17128, 0.033235, 0.0494848, - 0.0557997, 0.181813, 0.0404443, 0.0592394, - 0.0635578, 0.198745, 0.0490043, 0.0681463, - 0.071838, 0.210497, 0.0588239, 0.0804753, - 0.0809297, 0.228864, 0.0702835, 0.0942205, - 0.0906488, 0.247008, 0.0834012, 0.106777, - 0.100216, 0.258812, 0.0975952, 0.124471, - 0.110827, 0.278617, 0.114162, 0.138389, - 0.121193, 0.287049, 0.131983, 0.159543, - 0.13253, 0.307151, 0.152541, 0.176432, - 0.143611, 0.31564, 0.174673, 0.201723, - 0.15548, 0.33538, 0.199842, 0.229721, - 0.167166, 0.355256, 0.227097, 0.250206, - 0.178238, 0.360047, 0.256014, 0.282118, - 0.189905, 0.378761, 0.28855, 0.312821, - 0.201033, 0.39181, 0.323348, 0.341482, - 0.211584, 0.397716, 0.360564, 0.377368, - 0.221314, 0.410141, 0.400004, 0.418229, - 0.230474, 0.423485, 0.442371, 0.444881, - 0.239443, 0.418874, 0.488796, 0.488899, - 0.245987, 0.427545, 0.535012, 0.520317, - 0.253948, 0.422147, 0.589678, 0.568566, - 0.256616, 0.42719, 0.637683, 0.599607, - 0.26376, 0.415114, 0.703363, 0.64222, - 0.268687, 0.408715, 0.771363, 0.685698, - 0.2694, 0.399722, 0.83574, 0.732327, - 0.266642, 0.388651, 0.897764, 0.769873, - 0.267712, 0.369198, 0.983312, 0.806733, - 0.263479, 0.346802, 1.06222, 0.843466, - 0.254575, 0.321368, 1.13477, 0.873008, - 0.242749, 0.29211, 1.20712, 0.908438, - 0.22725, 0.262143, 1.27465, 0.936321, - 0.207621, 0.228876, 1.33203, 0.950353, - 0.187932, 0.19484, 1.40439, 0.96442, - 0.165154, 0.163178, 1.4732, 0.979856, - 0.139302, 0.127531, 1.53574, 0.982561, - 0.11134, 0.0903457, 1.59982, 0.996389, - 0.0808124, 0.0489007, 1.6577 ];
			const LTC_MAT_2 = [ 1, 0, 0, 0, 1, 7.91421e-31, 0, 0, 1, 1.04392e-24, 0, 0, 1, 3.49405e-21, 0, 0, 1, 1.09923e-18, 0, 0, 1, 9.47414e-17, 0, 0, 1, 3.59627e-15, 0, 0, 1, 7.72053e-14, 0, 0, 1, 1.08799e-12, 0, 0, 1, 1.10655e-11, 0, 0, 1, 8.65818e-11, 0, 0, 0.999998, 5.45037e-10, 0, 0, 0.999994, 2.85095e-09, 0, 0, 0.999989, 1.26931e-08, 0, 0, 0.999973, 4.89938e-08, 0, 0, 0.999947, 1.66347e-07, 0, 0, 0.999894, 5.02694e-07, 0, 0, 0.999798, 1.36532e-06, 0, 0, 0.999617, 3.35898e-06, 0, 0, 0.999234, 7.52126e-06, 0, 0, 0.998258, 1.52586e-05, 0, 0, 0.99504, 2.66207e-05, 0, 0, 0.980816, 2.36802e-05, 0, 0, 0.967553, 2.07684e-06, 0, 0, 0.966877, 4.03733e-06, 0, 0, 0.965752, 7.41174e-06, 0, 0, 0.96382, 1.27746e-05, 0, 0, 0.960306, 2.02792e-05, 0, 0, 0.953619, 2.80232e-05, 0, 0, 0.941103, 2.78816e-05, 0, 0, 0.926619, 1.60221e-05, 0, 0, 0.920983, 2.35164e-05, 0, 0, 0.912293, 3.11924e-05, 0, 0.0158731, 0.899277, 3.48118e-05, 0, 0.0476191, 0.880884, 2.6041e-05, 0, 0.0793651, 0.870399, 3.38726e-05, 0, 0.111111, 0.856138, 3.92906e-05, 0, 0.142857, 0.837436, 3.72874e-05, 0, 0.174603, 0.820973, 3.92558e-05, 0, 0.206349, 0.803583, 4.34658e-05, 0, 0.238095, 0.782168, 4.0256e-05, 0, 0.269841, 0.764107, 4.48159e-05, 0, 0.301587, 0.743092, 4.57627e-05, 0, 0.333333, 0.721626, 4.55314e-05, 0, 0.365079, 0.700375, 4.77335e-05, 0, 0.396825, 0.677334, 4.61072e-05, 0, 0.428571, 0.655702, 4.84393e-05, 0, 0.460317, 0.632059, 4.64583e-05, 0, 0.492064, 0.610125, 4.83923e-05, 0, 0.52381, 0.58653, 4.64342e-05, 0, 0.555556, 0.564508, 4.77033e-05, 0, 0.587302, 0.541405, 4.59263e-05, 0, 0.619048, 0.519556, 4.6412e-05, 0, 0.650794, 0.497292, 4.48913e-05, 0, 0.68254, 0.475898, 4.45789e-05, 0, 0.714286, 0.454722, 4.33496e-05, 0, 0.746032, 0.434042, 4.23054e-05, 0, 0.777778, 0.414126, 4.13737e-05, 0, 0.809524, 0.394387, 3.97265e-05, 0, 0.84127, 0.375841, 3.90709e-05, 0, 0.873016, 0.357219, 3.69938e-05, 0, 0.904762, 0.340084, 3.65618e-05, 0, 0.936508, 0.322714, 3.42533e-05, 0, 0.968254, 0.306974, 3.39596e-05, 0, 1, 1, 1.01524e-18, 0, 0, 1, 1.0292e-18, 0, 0, 1, 1.30908e-18, 0, 0, 1, 4.73331e-18, 0, 0, 1, 6.25319e-17, 0, 0, 1, 1.07932e-15, 0, 0, 1, 1.63779e-14, 0, 0, 1, 2.03198e-13, 0, 0, 1, 2.04717e-12, 0, 0, 0.999999, 1.68995e-11, 0, 0, 0.999998, 1.15855e-10, 0, 0, 0.999996, 6.6947e-10, 0, 0, 0.999991, 3.30863e-09, 0, 0, 0.999983, 1.41737e-08, 0, 0, 0.999968, 5.32626e-08, 0, 0, 0.99994, 1.77431e-07, 0, 0, 0.999891, 5.28835e-07, 0, 0, 0.999797, 1.42169e-06, 0, 0, 0.999617, 3.47057e-06, 0, 0, 0.999227, 7.7231e-06, 0, 0, 0.998239, 1.55753e-05, 0, 0, 0.994937, 2.68495e-05, 0, 0, 0.980225, 2.13742e-05, 0, 0, 0.967549, 2.1631e-06, 0, 0, 0.966865, 4.17989e-06, 0, 0, 0.965739, 7.63341e-06, 0, 0, 0.963794, 1.30892e-05, 0, 0, 0.960244, 2.06456e-05, 0, 0, 0.953495, 2.82016e-05, 0, 0.000148105, 0.940876, 2.71581e-05, 0, 0.002454, 0.926569, 1.64159e-05, 0, 0.00867491, 0.920905, 2.39521e-05, 0, 0.01956, 0.912169, 3.15127e-05, 0, 0.035433, 0.899095, 3.46626e-05, 0, 0.056294, 0.882209, 2.90223e-05, 0, 0.0818191, 0.870272, 3.42992e-05, 0, 0.111259, 0.855977, 3.94164e-05, 0, 0.142857, 0.837431, 3.72343e-05, 0, 0.174603, 0.820826, 3.96691e-05, 0, 0.206349, 0.803408, 4.35395e-05, 0, 0.238095, 0.782838, 4.19579e-05, 0, 0.269841, 0.763941, 4.50953e-05, 0, 0.301587, 0.742904, 4.55847e-05, 0, 0.333333, 0.721463, 4.58833e-05, 0, 0.365079, 0.700197, 4.77159e-05, 0, 0.396825, 0.677501, 4.70641e-05, 0, 0.428571, 0.655527, 4.84732e-05, 0, 0.460317, 0.6324, 4.76834e-05, 0, 0.492064, 0.609964, 4.84213e-05, 0, 0.52381, 0.586839, 4.75541e-05, 0, 0.555556, 0.564353, 4.76951e-05, 0, 0.587302, 0.541589, 4.67611e-05, 0, 0.619048, 0.519413, 4.63493e-05, 0, 0.650794, 0.497337, 4.53994e-05, 0, 0.68254, 0.475797, 4.45308e-05, 0, 0.714286, 0.454659, 4.35787e-05, 0, 0.746032, 0.434065, 4.24839e-05, 0, 0.777778, 0.414018, 4.1436e-05, 0, 0.809524, 0.39455, 4.01902e-05, 0, 0.84127, 0.375742, 3.90813e-05, 0, 0.873016, 0.357501, 3.77116e-05, 0, 0.904762, 0.339996, 3.6535e-05, 0, 0.936508, 0.323069, 3.51265e-05, 0, 0.968254, 0.306897, 3.39112e-05, 0, 1, 1, 1.0396e-15, 0, 0, 1, 1.04326e-15, 0, 0, 1, 1.10153e-15, 0, 0, 1, 1.44668e-15, 0, 0, 1, 3.4528e-15, 0, 0, 1, 1.75958e-14, 0, 0, 1, 1.2627e-13, 0, 0, 1, 9.36074e-13, 0, 0, 1, 6.45742e-12, 0, 0, 0.999998, 4.01228e-11, 0, 0, 0.999997, 2.22338e-10, 0, 0, 0.999995, 1.0967e-09, 0, 0, 0.999991, 4.82132e-09, 0, 0, 0.999981, 1.89434e-08, 0, 0, 0.999967, 6.67716e-08, 0, 0, 0.999938, 2.12066e-07, 0, 0, 0.999886, 6.0977e-07, 0, 0, 0.999792, 1.59504e-06, 0, 0, 0.999608, 3.81191e-06, 0, 0, 0.999209, 8.33727e-06, 0, 0, 0.998179, 1.65288e-05, 0, 0, 0.994605, 2.74387e-05, 0, 0, 0.979468, 1.67316e-05, 0, 0, 0.967529, 2.42877e-06, 0, 0, 0.966836, 4.61696e-06, 0, 0, 0.96569, 8.30977e-06, 0, 0, 0.963706, 1.40427e-05, 0, 2.44659e-06, 0.960063, 2.17353e-05, 0, 0.000760774, 0.953113, 2.86606e-05, 0, 0.00367261, 0.940192, 2.47691e-05, 0, 0.00940263, 0.927731, 1.95814e-05, 0, 0.018333, 0.920669, 2.52531e-05, 0, 0.0306825, 0.911799, 3.24277e-05, 0, 0.0465556, 0.89857, 3.40982e-05, 0, 0.0659521, 0.883283, 3.19622e-05, 0, 0.0887677, 0.86989, 3.5548e-05, 0, 0.114784, 0.855483, 3.97143e-05, 0, 0.143618, 0.837987, 3.91665e-05, 0, 0.174606, 0.820546, 4.11306e-05, 0, 0.206349, 0.802878, 4.36753e-05, 0, 0.238095, 0.783402, 4.44e-05, 0, 0.269841, 0.763439, 4.58726e-05, 0, 0.301587, 0.742925, 4.67097e-05, 0, 0.333333, 0.721633, 4.78887e-05, 0, 0.365079, 0.69985, 4.81251e-05, 0, 0.396825, 0.67783, 4.91811e-05, 0, 0.428571, 0.655126, 4.88199e-05, 0, 0.460318, 0.632697, 4.96025e-05, 0, 0.492064, 0.609613, 4.8829e-05, 0, 0.52381, 0.587098, 4.92754e-05, 0, 0.555556, 0.564119, 4.82625e-05, 0, 0.587302, 0.541813, 4.82807e-05, 0, 0.619048, 0.519342, 4.71552e-05, 0, 0.650794, 0.497514, 4.66765e-05, 0, 0.68254, 0.475879, 4.55582e-05, 0, 0.714286, 0.454789, 4.46007e-05, 0, 0.746032, 0.434217, 4.35382e-05, 0, 0.777778, 0.414086, 4.21753e-05, 0, 0.809524, 0.394744, 4.12093e-05, 0, 0.84127, 0.375782, 3.96634e-05, 0, 0.873016, 0.357707, 3.86419e-05, 0, 0.904762, 0.340038, 3.70345e-05, 0, 0.936508, 0.323284, 3.59725e-05, 0, 0.968254, 0.306954, 3.436e-05, 0, 1, 1, 5.99567e-14, 0, 0, 1, 6.00497e-14, 0, 0, 1, 6.14839e-14, 0, 0, 1, 6.86641e-14, 0, 0, 1, 9.72658e-14, 0, 0, 1, 2.21271e-13, 0, 0, 1, 8.33195e-13, 0, 0, 1, 4.03601e-12, 0, 0, 0.999999, 2.06001e-11, 0, 0, 0.999998, 1.01739e-10, 0, 0, 0.999997, 4.70132e-10, 0, 0, 0.999993, 2.00436e-09, 0, 0, 0.999988, 7.83682e-09, 0, 0, 0.999979, 2.80338e-08, 0, 0, 0.999962, 9.17033e-08, 0, 0, 0.999933, 2.74514e-07, 0, 0, 0.999881, 7.53201e-07, 0, 0, 0.999783, 1.89826e-06, 0, 0, 0.999594, 4.40279e-06, 0, 0, 0.999178, 9.3898e-06, 0, 0, 0.998073, 1.81265e-05, 0, 0, 0.993993, 2.80487e-05, 0, 0, 0.979982, 1.49422e-05, 0, 0, 0.968145, 3.78481e-06, 0, 0, 0.966786, 5.3771e-06, 0, 0, 0.965611, 9.47508e-06, 0, 3.88934e-05, 0.963557, 1.56616e-05, 0, 0.0009693, 0.959752, 2.35144e-05, 0, 0.00370329, 0.952461, 2.91568e-05, 0, 0.00868428, 0.940193, 2.40102e-05, 0, 0.0161889, 0.929042, 2.31235e-05, 0, 0.0263948, 0.920266, 2.73968e-05, 0, 0.0394088, 0.911178, 3.37915e-05, 0, 0.0552818, 0.897873, 3.33629e-05, 0, 0.0740138, 0.884053, 3.51405e-05, 0, 0.0955539, 0.869455, 3.78034e-05, 0, 0.119795, 0.854655, 3.99378e-05, 0, 0.14656, 0.838347, 4.19108e-05, 0, 0.175573, 0.820693, 4.40831e-05, 0, 0.206388, 0.802277, 4.45599e-05, 0, 0.238095, 0.783634, 4.72691e-05, 0, 0.269841, 0.763159, 4.76984e-05, 0, 0.301587, 0.742914, 4.91487e-05, 0, 0.333333, 0.721662, 5.02312e-05, 0, 0.365079, 0.699668, 5.02817e-05, 0, 0.396825, 0.677839, 5.1406e-05, 0, 0.428571, 0.655091, 5.11095e-05, 0, 0.460317, 0.632665, 5.16067e-05, 0, 0.492064, 0.609734, 5.12255e-05, 0, 0.52381, 0.587043, 5.10263e-05, 0, 0.555556, 0.564298, 5.0565e-05, 0, 0.587302, 0.541769, 4.97951e-05, 0, 0.619048, 0.519529, 4.92698e-05, 0, 0.650794, 0.497574, 4.82066e-05, 0, 0.68254, 0.476028, 4.73689e-05, 0, 0.714286, 0.454961, 4.61941e-05, 0, 0.746032, 0.434341, 4.50618e-05, 0, 0.777778, 0.414364, 4.38355e-05, 0, 0.809524, 0.394832, 4.24196e-05, 0, 0.84127, 0.376109, 4.12563e-05, 0, 0.873016, 0.35779, 3.96226e-05, 0, 0.904762, 0.340379, 3.84886e-05, 0, 0.936508, 0.323385, 3.68214e-05, 0, 0.968254, 0.307295, 3.56636e-05, 0, 1, 1, 1.06465e-12, 0, 0, 1, 1.06555e-12, 0, 0, 1, 1.07966e-12, 0, 0, 1, 1.14601e-12, 0, 0, 1, 1.37123e-12, 0, 0, 1, 2.1243e-12, 0, 0, 0.999999, 4.89653e-12, 0, 0, 0.999999, 1.60283e-11, 0, 0, 0.999998, 6.2269e-11, 0, 0, 0.999997, 2.51859e-10, 0, 0, 0.999996, 9.96192e-10, 0, 0, 0.999992, 3.74531e-09, 0, 0, 0.999986, 1.32022e-08, 0, 0, 0.999975, 4.33315e-08, 0, 0, 0.999959, 1.31956e-07, 0, 0, 0.999927, 3.72249e-07, 0, 0, 0.999871, 9.72461e-07, 0, 0, 0.999771, 2.35343e-06, 0, 0, 0.999572, 5.2768e-06, 0, 0, 0.999133, 1.09237e-05, 0, 0, 0.997912, 2.03675e-05, 0, 0, 0.993008, 2.79396e-05, 0, 0, 0.980645, 1.39604e-05, 0, 0, 0.970057, 6.46596e-06, 0, 0, 0.966717, 6.5089e-06, 0, 4.74145e-05, 0.965497, 1.11863e-05, 0, 0.00089544, 0.96334, 1.79857e-05, 0, 0.0032647, 0.959294, 2.59045e-05, 0, 0.0075144, 0.951519, 2.92327e-05, 0, 0.0138734, 0.940517, 2.49769e-05, 0, 0.0224952, 0.93014, 2.6803e-05, 0, 0.0334828, 0.91972, 3.03656e-05, 0, 0.0468973, 0.910294, 3.53323e-05, 0, 0.0627703, 0.897701, 3.51002e-05, 0, 0.0811019, 0.884522, 3.88104e-05, 0, 0.10186, 0.869489, 4.12932e-05, 0, 0.124985, 0.853983, 4.15781e-05, 0, 0.150372, 0.838425, 4.54066e-05, 0, 0.177868, 0.820656, 4.71624e-05, 0, 0.207245, 0.801875, 4.75243e-05, 0, 0.238143, 0.783521, 5.05621e-05, 0, 0.269841, 0.763131, 5.0721e-05, 0, 0.301587, 0.74261, 5.23293e-05, 0, 0.333333, 0.72148, 5.28699e-05, 0, 0.365079, 0.699696, 5.38677e-05, 0, 0.396825, 0.677592, 5.39255e-05, 0, 0.428571, 0.65525, 5.46367e-05, 0, 0.460317, 0.632452, 5.41348e-05, 0, 0.492064, 0.609903, 5.44976e-05, 0, 0.52381, 0.586928, 5.36201e-05, 0, 0.555556, 0.564464, 5.35185e-05, 0, 0.587302, 0.541801, 5.24949e-05, 0, 0.619048, 0.519681, 5.1812e-05, 0, 0.650794, 0.497685, 5.07687e-05, 0, 0.68254, 0.47622, 4.96243e-05, 0, 0.714286, 0.455135, 4.85714e-05, 0, 0.746032, 0.4346, 4.71847e-05, 0, 0.777778, 0.414564, 4.59294e-05, 0, 0.809524, 0.395165, 4.44705e-05, 0, 0.84127, 0.376333, 4.30772e-05, 0, 0.873016, 0.358197, 4.16229e-05, 0, 0.904762, 0.34064, 4.01019e-05, 0, 0.936508, 0.323816, 3.86623e-05, 0, 0.968254, 0.307581, 3.70933e-05, 0, 1, 1, 9.91541e-12, 0, 0, 1, 9.92077e-12, 0, 0, 1, 1.00041e-11, 0, 0, 1, 1.0385e-11, 0, 0, 1, 1.15777e-11, 0, 0, 1, 1.50215e-11, 0, 0, 0.999999, 2.54738e-11, 0, 0, 0.999999, 5.98822e-11, 0, 0, 0.999998, 1.79597e-10, 0, 0, 0.999997, 6.02367e-10, 0, 0, 0.999994, 2.06835e-09, 0, 0, 0.99999, 6.94952e-09, 0, 0, 0.999984, 2.23363e-08, 0, 0, 0.999972, 6.78578e-08, 0, 0, 0.999952, 1.93571e-07, 0, 0, 0.999919, 5.16594e-07, 0, 0, 0.99986, 1.28739e-06, 0, 0, 0.999753, 2.99298e-06, 0, 0, 0.999546, 6.48258e-06, 0, 0, 0.999074, 1.29985e-05, 0, 0, 0.997671, 2.32176e-05, 0, 0, 0.991504, 2.56701e-05, 0, 0, 0.981148, 1.31141e-05, 0, 0, 0.971965, 8.69048e-06, 0, 2.80182e-05, 0.966624, 8.08301e-06, 0, 0.000695475, 0.965344, 1.35235e-05, 0, 0.00265522, 0.963048, 2.10592e-05, 0, 0.00622975, 0.958673, 2.87473e-05, 0, 0.0116234, 0.950262, 2.81379e-05, 0, 0.018976, 0.940836, 2.71089e-05, 0, 0.0283844, 0.930996, 3.0926e-05, 0, 0.0399151, 0.919848, 3.48359e-05, 0, 0.0536063, 0.909136, 3.66092e-05, 0, 0.0694793, 0.897554, 3.84162e-05, 0, 0.0875342, 0.884691, 4.30971e-05, 0, 0.107749, 0.869414, 4.47803e-05, 0, 0.130087, 0.853462, 4.52858e-05, 0, 0.154481, 0.838187, 4.95769e-05, 0, 0.180833, 0.820381, 5.02709e-05, 0, 0.209005, 0.801844, 5.22713e-05, 0, 0.238791, 0.783061, 5.41505e-05, 0, 0.269869, 0.763205, 5.53712e-05, 0, 0.301587, 0.742362, 5.64909e-05, 0, 0.333333, 0.721393, 5.72646e-05, 0, 0.365079, 0.699676, 5.81012e-05, 0, 0.396825, 0.677395, 5.8096e-05, 0, 0.428571, 0.655208, 5.85766e-05, 0, 0.460317, 0.632451, 5.83602e-05, 0, 0.492064, 0.609839, 5.80234e-05, 0, 0.52381, 0.587093, 5.77161e-05, 0, 0.555556, 0.564467, 5.68447e-05, 0, 0.587302, 0.542043, 5.63166e-05, 0, 0.619048, 0.519826, 5.5156e-05, 0, 0.650794, 0.497952, 5.41682e-05, 0, 0.68254, 0.476477, 5.28971e-05, 0, 0.714286, 0.455412, 5.14952e-05, 0, 0.746032, 0.434926, 5.02222e-05, 0, 0.777778, 0.4149, 4.85779e-05, 0, 0.809524, 0.395552, 4.72242e-05, 0, 0.84127, 0.376712, 4.54891e-05, 0, 0.873016, 0.358622, 4.40924e-05, 0, 0.904762, 0.341048, 4.22984e-05, 0, 0.936508, 0.324262, 4.08582e-05, 0, 0.968254, 0.308013, 3.90839e-05, 0, 1, 1, 6.13913e-11, 0, 0, 1, 6.14145e-11, 0, 0, 1, 6.17708e-11, 0, 0, 1, 6.33717e-11, 0, 0, 1, 6.81648e-11, 0, 0, 1, 8.08291e-11, 0, 0, 1, 1.14608e-10, 0, 0, 0.999998, 2.10507e-10, 0, 0, 0.999997, 4.99595e-10, 0, 0, 0.999995, 1.39897e-09, 0, 0, 0.999994, 4.19818e-09, 0, 0, 0.999988, 1.27042e-08, 0, 0, 0.999979, 3.75153e-08, 0, 0, 0.999965, 1.06206e-07, 0, 0, 0.999945, 2.85381e-07, 0, 0, 0.999908, 7.23611e-07, 0, 0, 0.999846, 1.7255e-06, 0, 0, 0.999733, 3.86104e-06, 0, 0, 0.999511, 8.08493e-06, 0, 0, 0.998993, 1.56884e-05, 0, 0, 0.997326, 2.65538e-05, 0, 0, 0.989706, 2.06466e-05, 0, 0, 0.981713, 1.30756e-05, 0, 7.0005e-06, 0.973636, 1.06473e-05, 0, 0.000464797, 0.966509, 1.0194e-05, 0, 0.00201743, 0.965149, 1.65881e-05, 0, 0.00497549, 0.962669, 2.49147e-05, 0, 0.00953262, 0.95786, 3.17449e-05, 0, 0.0158211, 0.949334, 2.81045e-05, 0, 0.0239343, 0.941041, 3.03263e-05, 0, 0.0339372, 0.931575, 3.56754e-05, 0, 0.0458738, 0.920102, 3.97075e-05, 0, 0.059772, 0.908002, 3.84886e-05, 0, 0.075645, 0.897269, 4.3027e-05, 0, 0.0934929, 0.884559, 4.79925e-05, 0, 0.113302, 0.869161, 4.8246e-05, 0, 0.135045, 0.853342, 5.09505e-05, 0, 0.158678, 0.837633, 5.42846e-05, 0, 0.184136, 0.820252, 5.54139e-05, 0, 0.211325, 0.801872, 5.81412e-05, 0, 0.240113, 0.782418, 5.85535e-05, 0, 0.270306, 0.7631, 6.10923e-05, 0, 0.301594, 0.742183, 6.13678e-05, 0, 0.333333, 0.721098, 6.27275e-05, 0, 0.365079, 0.699512, 6.29413e-05, 0, 0.396825, 0.677372, 6.36351e-05, 0, 0.428571, 0.655059, 6.33555e-05, 0, 0.460317, 0.632567, 6.36513e-05, 0, 0.492064, 0.609784, 6.28965e-05, 0, 0.52381, 0.587237, 6.25546e-05, 0, 0.555556, 0.564525, 6.15825e-05, 0, 0.587302, 0.542181, 6.05048e-05, 0, 0.619048, 0.520017, 5.96329e-05, 0, 0.650794, 0.498204, 5.81516e-05, 0, 0.68254, 0.476742, 5.69186e-05, 0, 0.714286, 0.455803, 5.53833e-05, 0, 0.746032, 0.435251, 5.37807e-05, 0, 0.777778, 0.415374, 5.22025e-05, 0, 0.809524, 0.395921, 5.03421e-05, 0, 0.84127, 0.377253, 4.88211e-05, 0, 0.873016, 0.359021, 4.68234e-05, 0, 0.904762, 0.341637, 4.53269e-05, 0, 0.936508, 0.3247, 4.33014e-05, 0, 0.968254, 0.308625, 4.18007e-05, 0, 1, 1, 2.86798e-10, 0, 0, 1, 2.86877e-10, 0, 0, 1, 2.88094e-10, 0, 0, 1, 2.93506e-10, 0, 0, 1, 3.09262e-10, 0, 0, 0.999999, 3.48593e-10, 0, 0, 0.999999, 4.44582e-10, 0, 0, 0.999998, 6.88591e-10, 0, 0, 0.999996, 1.34391e-09, 0, 0, 0.999993, 3.17438e-09, 0, 0, 0.999989, 8.35609e-09, 0, 0, 0.999983, 2.28677e-08, 0, 0, 0.999974, 6.23361e-08, 0, 0, 0.999959, 1.65225e-07, 0, 0, 0.999936, 4.19983e-07, 0, 0, 0.999896, 1.01546e-06, 0, 0, 0.99983, 2.32376e-06, 0, 0, 0.999709, 5.0156e-06, 0, 0, 0.999469, 1.0167e-05, 0, 0, 0.998886, 1.90775e-05, 0, 0, 0.996819, 3.00511e-05, 0, 0, 0.988837, 1.85092e-05, 0, 1.68222e-07, 0.982178, 1.34622e-05, 0, 0.000259622, 0.975017, 1.25961e-05, 0, 0.00142595, 0.967101, 1.3507e-05, 0, 0.00382273, 0.964905, 2.05003e-05, 0, 0.00764164, 0.96218, 2.9546e-05, 0, 0.0130121, 0.956821, 3.43738e-05, 0, 0.0200253, 0.948829, 3.05063e-05, 0, 0.0287452, 0.941092, 3.46487e-05, 0, 0.039218, 0.931883, 4.12061e-05, 0, 0.0514748, 0.920211, 4.44651e-05, 0, 0.0655351, 0.907307, 4.31252e-05, 0, 0.0814082, 0.89684, 4.90382e-05, 0, 0.0990939, 0.884119, 5.3334e-05, 0, 0.118583, 0.869148, 5.4114e-05, 0, 0.139856, 0.853377, 5.78536e-05, 0, 0.162882, 0.836753, 5.92285e-05, 0, 0.187615, 0.820063, 6.22787e-05, 0, 0.213991, 0.801694, 6.45492e-05, 0, 0.241918, 0.782116, 6.5353e-05, 0, 0.271267, 0.762673, 6.74344e-05, 0, 0.301847, 0.742133, 6.82788e-05, 0, 0.333333, 0.720779, 6.91959e-05, 0, 0.365079, 0.699386, 6.96817e-05, 0, 0.396826, 0.67732, 6.99583e-05, 0, 0.428572, 0.654888, 6.98447e-05, 0, 0.460318, 0.632499, 6.94063e-05, 0, 0.492064, 0.609825, 6.91612e-05, 0, 0.52381, 0.587287, 6.81576e-05, 0, 0.555556, 0.564743, 6.74138e-05, 0, 0.587302, 0.542409, 6.61617e-05, 0, 0.619048, 0.520282, 6.47785e-05, 0, 0.650794, 0.498506, 6.33836e-05, 0, 0.68254, 0.477102, 6.15905e-05, 0, 0.714286, 0.456167, 6.01013e-05, 0, 0.746032, 0.435728, 5.81457e-05, 0, 0.777778, 0.415809, 5.64215e-05, 0, 0.809524, 0.396517, 5.44997e-05, 0, 0.84127, 0.377737, 5.25061e-05, 0, 0.873016, 0.359698, 5.06831e-05, 0, 0.904762, 0.342164, 4.8568e-05, 0, 0.936508, 0.325417, 4.67826e-05, 0, 0.968254, 0.309186, 4.46736e-05, 0, 1, 1, 1.09018e-09, 0, 0, 1, 1.0904e-09, 0, 0, 1, 1.09393e-09, 0, 0, 1, 1.1095e-09, 0, 0, 1, 1.154e-09, 0, 0, 1, 1.26089e-09, 0, 0, 0.999999, 1.5059e-09, 0, 0, 0.999997, 2.07899e-09, 0, 0, 0.999994, 3.48164e-09, 0, 0, 0.999993, 7.05728e-09, 0, 0, 0.999987, 1.63692e-08, 0, 0, 0.999981, 4.06033e-08, 0, 0, 0.999969, 1.0245e-07, 0, 0, 0.999953, 2.55023e-07, 0, 0, 0.999925, 6.1511e-07, 0, 0, 0.999881, 1.42218e-06, 0, 0, 0.99981, 3.13086e-06, 0, 0, 0.99968, 6.53119e-06, 0, 0, 0.999418, 1.2832e-05, 0, 0, 0.998748, 2.32497e-05, 0, 0, 0.996066, 3.29522e-05, 0, 0, 0.988379, 1.79613e-05, 0, 0.000108799, 0.982567, 1.43715e-05, 0, 0.000921302, 0.976097, 1.48096e-05, 0, 0.00280738, 0.968475, 1.78905e-05, 0, 0.00596622, 0.964606, 2.53921e-05, 0, 0.0105284, 0.961564, 3.48623e-05, 0, 0.0165848, 0.955517, 3.57612e-05, 0, 0.0242, 0.948381, 3.43493e-05, 0, 0.03342, 0.941095, 4.05849e-05, 0, 0.0442777, 0.931923, 4.75394e-05, 0, 0.0567958, 0.91996, 4.84328e-05, 0, 0.0709879, 0.907419, 5.02146e-05, 0, 0.086861, 0.89618, 5.61654e-05, 0, 0.104415, 0.88337, 5.87612e-05, 0, 0.123643, 0.869046, 6.18057e-05, 0, 0.144531, 0.853278, 6.57392e-05, 0, 0.167057, 0.836091, 6.6303e-05, 0, 0.191188, 0.819644, 7.04445e-05, 0, 0.216878, 0.801246, 7.14071e-05, 0, 0.244062, 0.782031, 7.40093e-05, 0, 0.272649, 0.762066, 7.4685e-05, 0, 0.302509, 0.741964, 7.66647e-05, 0, 0.333442, 0.720554, 7.66328e-05, 0, 0.365079, 0.699098, 7.77857e-05, 0, 0.396826, 0.677189, 7.74633e-05, 0, 0.428572, 0.65484, 7.76235e-05, 0, 0.460318, 0.632496, 7.70316e-05, 0, 0.492064, 0.609908, 7.62669e-05, 0, 0.52381, 0.587312, 7.53972e-05, 0, 0.555556, 0.564938, 7.39994e-05, 0, 0.587302, 0.542577, 7.28382e-05, 0, 0.619048, 0.52062, 7.1112e-05, 0, 0.650794, 0.498819, 6.94004e-05, 0, 0.68254, 0.477555, 6.75575e-05, 0, 0.714286, 0.456568, 6.53449e-05, 0, 0.746032, 0.436278, 6.36068e-05, 0, 0.777778, 0.41637, 6.13466e-05, 0, 0.809524, 0.397144, 5.94177e-05, 0, 0.84127, 0.378412, 5.70987e-05, 0, 0.873016, 0.360376, 5.50419e-05, 0, 0.904762, 0.342906, 5.27422e-05, 0, 0.936508, 0.326136, 5.06544e-05, 0, 0.968254, 0.30997, 4.84307e-05, 0, 1, 1, 3.54014e-09, 0, 0, 1, 3.54073e-09, 0, 0, 1, 3.54972e-09, 0, 0, 1, 3.58929e-09, 0, 0, 1, 3.70093e-09, 0, 0, 0.999999, 3.96194e-09, 0, 0, 0.999998, 4.53352e-09, 0, 0, 0.999997, 5.78828e-09, 0, 0, 0.999994, 8.63812e-09, 0, 0, 0.999991, 1.53622e-08, 0, 0, 0.999985, 3.16356e-08, 0, 0, 0.999977, 7.12781e-08, 0, 0, 0.999964, 1.66725e-07, 0, 0, 0.999945, 3.90501e-07, 0, 0, 0.999912, 8.95622e-07, 0, 0, 0.999866, 1.98428e-06, 0, 0, 0.999786, 4.21038e-06, 0, 0, 0.999647, 8.50239e-06, 0, 0, 0.999356, 1.62059e-05, 0, 0, 0.998563, 2.82652e-05, 0, 0, 0.994928, 3.36309e-05, 0, 2.44244e-05, 0.987999, 1.78458e-05, 0, 0.000523891, 0.982893, 1.59162e-05, 0, 0.00194729, 0.977044, 1.78056e-05, 0, 0.00451099, 0.969972, 2.30624e-05, 0, 0.00835132, 0.964237, 3.13922e-05, 0, 0.013561, 0.960791, 4.06145e-05, 0, 0.0202056, 0.954292, 3.72796e-05, 0, 0.0283321, 0.948052, 4.03199e-05, 0, 0.0379739, 0.940938, 4.79537e-05, 0, 0.0491551, 0.931689, 5.45292e-05, 0, 0.0618918, 0.91987, 5.4038e-05, 0, 0.0761941, 0.907665, 5.89909e-05, 0, 0.0920672, 0.895281, 6.42651e-05, 0, 0.109511, 0.882621, 6.59707e-05, 0, 0.12852, 0.86873, 7.09973e-05, 0, 0.149085, 0.853008, 7.42221e-05, 0, 0.171189, 0.835944, 7.61754e-05, 0, 0.194809, 0.818949, 7.97052e-05, 0, 0.21991, 0.800951, 8.12434e-05, 0, 0.246447, 0.781847, 8.38075e-05, 0, 0.274352, 0.761649, 8.4501e-05, 0, 0.303535, 0.74152, 8.60258e-05, 0, 0.333857, 0.720495, 8.66233e-05, 0, 0.365104, 0.698742, 8.68326e-05, 0, 0.396826, 0.677096, 8.7133e-05, 0, 0.428572, 0.654782, 8.63497e-05, 0, 0.460318, 0.632335, 8.60206e-05, 0, 0.492064, 0.610031, 8.49337e-05, 0, 0.52381, 0.587457, 8.38279e-05, 0, 0.555556, 0.56513, 8.2309e-05, 0, 0.587302, 0.542877, 8.03542e-05, 0, 0.619048, 0.5209, 7.86928e-05, 0, 0.650794, 0.499291, 7.65171e-05, 0, 0.68254, 0.477971, 7.44753e-05, 0, 0.714286, 0.457221, 7.2209e-05, 0, 0.746032, 0.436803, 6.97448e-05, 0, 0.777778, 0.417083, 6.75333e-05, 0, 0.809524, 0.397749, 6.48058e-05, 0, 0.84127, 0.379177, 6.25759e-05, 0, 0.873016, 0.361061, 5.98584e-05, 0, 0.904762, 0.343713, 5.75797e-05, 0, 0.936508, 0.326894, 5.49999e-05, 0, 0.968254, 0.310816, 5.27482e-05, 0, 1, 1, 1.0153e-08, 0, 0, 1, 1.01544e-08, 0, 0, 1, 1.01751e-08, 0, 0, 1, 1.02662e-08, 0, 0, 1, 1.0521e-08, 0, 0, 0.999999, 1.11049e-08, 0, 0, 0.999999, 1.23408e-08, 0, 0, 0.999996, 1.4924e-08, 0, 0, 0.999992, 2.04471e-08, 0, 0, 0.999989, 3.26539e-08, 0, 0, 0.99998, 6.03559e-08, 0, 0, 0.999971, 1.23936e-07, 0, 0, 0.999955, 2.69058e-07, 0, 0, 0.999933, 5.93604e-07, 0, 0, 0.999901, 1.29633e-06, 0, 0, 0.999847, 2.75621e-06, 0, 0, 0.999761, 5.64494e-06, 0, 0, 0.999607, 1.10485e-05, 0, 0, 0.999282, 2.04388e-05, 0, 0, 0.99831, 3.41084e-05, 0, 2.2038e-07, 0.993288, 2.94949e-05, 0, 0.000242388, 0.987855, 1.92736e-05, 0, 0.0012503, 0.983167, 1.82383e-05, 0, 0.0032745, 0.977908, 2.18633e-05, 0, 0.00646321, 0.971194, 2.90662e-05, 0, 0.0109133, 0.963867, 3.86401e-05, 0, 0.0166927, 0.95982, 4.62827e-05, 0, 0.0238494, 0.953497, 4.20705e-05, 0, 0.0324178, 0.947621, 4.77743e-05, 0, 0.0424225, 0.940611, 5.68258e-05, 0, 0.0538808, 0.931174, 6.18061e-05, 0, 0.0668047, 0.919919, 6.27098e-05, 0, 0.0812014, 0.907856, 6.94714e-05, 0, 0.0970745, 0.894509, 7.35008e-05, 0, 0.114424, 0.881954, 7.63369e-05, 0, 0.133246, 0.868309, 8.21896e-05, 0, 0.153534, 0.852511, 8.3769e-05, 0, 0.175275, 0.835821, 8.81615e-05, 0, 0.198453, 0.817981, 8.96368e-05, 0, 0.223042, 0.800504, 9.30906e-05, 0, 0.249009, 0.78141, 9.45056e-05, 0, 0.276304, 0.761427, 9.63605e-05, 0, 0.304862, 0.74094, 9.68088e-05, 0, 0.334584, 0.720233, 9.81481e-05, 0, 0.365322, 0.698592, 9.79122e-05, 0, 0.396826, 0.676763, 9.81057e-05, 0, 0.428571, 0.654808, 9.73956e-05, 0, 0.460318, 0.632326, 9.62619e-05, 0, 0.492064, 0.610049, 9.52996e-05, 0, 0.52381, 0.58763, 9.33334e-05, 0, 0.555556, 0.565261, 9.17573e-05, 0, 0.587302, 0.543244, 8.96636e-05, 0, 0.619048, 0.521273, 8.73304e-05, 0, 0.650794, 0.499818, 8.52648e-05, 0, 0.68254, 0.478536, 8.23961e-05, 0, 0.714286, 0.457826, 7.9939e-05, 0, 0.746032, 0.437549, 7.7126e-05, 0, 0.777778, 0.41776, 7.43043e-05, 0, 0.809524, 0.39863, 7.16426e-05, 0, 0.84127, 0.379954, 6.86456e-05, 0, 0.873016, 0.362025, 6.60514e-05, 0, 0.904762, 0.344581, 6.30755e-05, 0, 0.936508, 0.327909, 6.05439e-05, 0, 0.968254, 0.311736, 5.76345e-05, 0, 1, 1, 2.63344e-08, 0, 0, 1, 2.63373e-08, 0, 0, 1, 2.63815e-08, 0, 0, 1, 2.65753e-08, 0, 0, 1, 2.71132e-08, 0, 0, 0.999999, 2.83279e-08, 0, 0, 0.999997, 3.0833e-08, 0, 0, 0.999995, 3.58711e-08, 0, 0, 0.999992, 4.61266e-08, 0, 0, 0.999985, 6.7574e-08, 0, 0, 0.999977, 1.1358e-07, 0, 0, 0.999966, 2.13657e-07, 0, 0, 0.999948, 4.31151e-07, 0, 0, 0.999923, 8.96656e-07, 0, 0, 0.999884, 1.86603e-06, 0, 0, 0.999826, 3.81115e-06, 0, 0, 0.999732, 7.54184e-06, 0, 0, 0.999561, 1.43192e-05, 0, 0, 0.999191, 2.57061e-05, 0, 0, 0.997955, 4.05724e-05, 0, 7.44132e-05, 0.992228, 2.76537e-05, 0, 0.000716477, 0.987638, 2.08885e-05, 0, 0.0022524, 0.983395, 2.15226e-05, 0, 0.00484816, 0.978614, 2.70795e-05, 0, 0.00860962, 0.972389, 3.65282e-05, 0, 0.0136083, 0.964392, 4.74747e-05, 0, 0.0198941, 0.95861, 5.09141e-05, 0, 0.0275023, 0.952806, 4.8963e-05, 0, 0.0364584, 0.94712, 5.71119e-05, 0, 0.04678, 0.940104, 6.71704e-05, 0, 0.0584799, 0.930398, 6.87586e-05, 0, 0.0715665, 0.919866, 7.38161e-05, 0, 0.086045, 0.907853, 8.13235e-05, 0, 0.101918, 0.894078, 8.34582e-05, 0, 0.119186, 0.881177, 8.92093e-05, 0, 0.137845, 0.867575, 9.44548e-05, 0, 0.157891, 0.852107, 9.69607e-05, 0, 0.179316, 0.835502, 0.000101456, 0, 0.202106, 0.81756, 0.000103256, 0, 0.226243, 0.79984, 0.000106954, 0, 0.251704, 0.780998, 0.000108066, 0, 0.278451, 0.761132, 0.000110111, 0, 0.306436, 0.740429, 0.000110459, 0, 0.335586, 0.719836, 0.000111219, 0, 0.365796, 0.698467, 0.00011145, 0, 0.3969, 0.676446, 0.000110393, 0, 0.428571, 0.654635, 0.000110035, 0, 0.460318, 0.632411, 0.000108548, 0, 0.492064, 0.609986, 0.000106963, 0, 0.52381, 0.587872, 0.000105238, 0, 0.555556, 0.565528, 0.000102665, 0, 0.587302, 0.543563, 0.000100543, 0, 0.619048, 0.52176, 9.76182e-05, 0, 0.650794, 0.500188, 9.47099e-05, 0, 0.68254, 0.479204, 9.19929e-05, 0, 0.714286, 0.458413, 8.86139e-05, 0, 0.746032, 0.438314, 8.57839e-05, 0, 0.777778, 0.418573, 8.2411e-05, 0, 0.809524, 0.39947, 7.92211e-05, 0, 0.84127, 0.380892, 7.59546e-05, 0, 0.873016, 0.362953, 7.27571e-05, 0, 0.904762, 0.345601, 6.95738e-05, 0, 0.936508, 0.328895, 6.64907e-05, 0, 0.968254, 0.312808, 6.34277e-05, 0, 1, 1, 6.28647e-08, 0, 0, 1, 6.28705e-08, 0, 0, 1, 6.29587e-08, 0, 0, 1, 6.33441e-08, 0, 0, 0.999999, 6.44087e-08, 0, 0, 0.999998, 6.67856e-08, 0, 0, 0.999997, 7.15889e-08, 0, 0, 0.999995, 8.09577e-08, 0, 0, 0.999989, 9.92764e-08, 0, 0, 0.999983, 1.35834e-07, 0, 0, 0.999974, 2.10482e-07, 0, 0, 0.999959, 3.65215e-07, 0, 0, 0.999939, 6.86693e-07, 0, 0, 0.999911, 1.3472e-06, 0, 0, 0.999868, 2.6731e-06, 0, 0, 0.999804, 5.24756e-06, 0, 0, 0.9997, 1.00403e-05, 0, 0, 0.99951, 1.85019e-05, 0, 0, 0.999078, 3.22036e-05, 0, 6.20676e-06, 0.997428, 4.70002e-05, 0, 0.000341552, 0.99162, 2.87123e-05, 0, 0.00143727, 0.987479, 2.34706e-05, 0, 0.00349201, 0.983582, 2.60083e-05, 0, 0.0066242, 0.979186, 3.37927e-05, 0, 0.0109113, 0.97325, 4.54689e-05, 0, 0.0164064, 0.965221, 5.73759e-05, 0, 0.0231463, 0.957262, 5.44114e-05, 0, 0.0311571, 0.952211, 5.87006e-05, 0, 0.0404572, 0.946631, 6.92256e-05, 0, 0.0510592, 0.939391, 7.87819e-05, 0, 0.0629723, 0.929795, 7.92368e-05, 0, 0.0762025, 0.91965, 8.75075e-05, 0, 0.090753, 0.907737, 9.50903e-05, 0, 0.106626, 0.893899, 9.72963e-05, 0, 0.123822, 0.880239, 0.00010459, 0, 0.142337, 0.866562, 0.000107689, 0, 0.16217, 0.85164, 0.000113081, 0, 0.183314, 0.835021, 0.000116636, 0, 0.20576, 0.817311, 0.000120074, 0, 0.229496, 0.798845, 0.000121921, 0, 0.254502, 0.780479, 0.00012475, 0, 0.280753, 0.760694, 0.000125255, 0, 0.308212, 0.740142, 0.000126719, 0, 0.336825, 0.719248, 0.00012636, 0, 0.366517, 0.698209, 0.000126712, 0, 0.397167, 0.676398, 0.000125769, 0, 0.428578, 0.654378, 0.000124432, 0, 0.460318, 0.632484, 0.000123272, 0, 0.492064, 0.610113, 0.00012085, 0, 0.52381, 0.587931, 0.000118411, 0, 0.555556, 0.565872, 0.00011569, 0, 0.587302, 0.543814, 0.000112521, 0, 0.619048, 0.522265, 0.000109737, 0, 0.650794, 0.500835, 0.000106228, 0, 0.68254, 0.479818, 0.000102591, 0, 0.714286, 0.459258, 9.91288e-05, 0, 0.746032, 0.439061, 9.52325e-05, 0, 0.777778, 0.419552, 9.1895e-05, 0, 0.809524, 0.400399, 8.79051e-05, 0, 0.84127, 0.381976, 8.44775e-05, 0, 0.873016, 0.364009, 8.06316e-05, 0, 0.904762, 0.346761, 7.71848e-05, 0, 0.936508, 0.330049, 7.35429e-05, 0, 0.968254, 0.314018, 7.02103e-05, 0, 1, 1, 1.39968e-07, 0, 0, 1, 1.39979e-07, 0, 0, 1, 1.40145e-07, 0, 0, 1, 1.4087e-07, 0, 0, 0.999999, 1.42865e-07, 0, 0, 0.999998, 1.47279e-07, 0, 0, 0.999997, 1.56057e-07, 0, 0, 0.999992, 1.7276e-07, 0, 0, 0.999989, 2.04352e-07, 0, 0, 0.99998, 2.6494e-07, 0, 0, 0.999969, 3.83435e-07, 0, 0, 0.999953, 6.18641e-07, 0, 0, 0.999929, 1.08755e-06, 0, 0, 0.999898, 2.01497e-06, 0, 0, 0.999849, 3.81346e-06, 0, 0, 0.999778, 7.19815e-06, 0, 0, 0.999661, 1.33215e-05, 0, 0, 0.999451, 2.38313e-05, 0, 0, 0.998936, 4.01343e-05, 0, 0.000113724, 0.99662, 5.17346e-05, 0, 0.000820171, 0.991094, 3.04323e-05, 0, 0.00238143, 0.987487, 2.81757e-05, 0, 0.00493527, 0.983731, 3.20048e-05, 0, 0.00856859, 0.979647, 4.23905e-05, 0, 0.0133393, 0.973837, 5.62935e-05, 0, 0.0192863, 0.96584, 6.77442e-05, 0, 0.0264369, 0.956309, 6.23073e-05, 0, 0.03481, 0.951523, 7.04131e-05, 0, 0.0444184, 0.946003, 8.36594e-05, 0, 0.0552713, 0.938454, 9.11736e-05, 0, 0.0673749, 0.929279, 9.38264e-05, 0, 0.0807329, 0.919239, 0.000103754, 0, 0.0953479, 0.907293, 0.000109928, 0, 0.111221, 0.893936, 0.000115257, 0, 0.128352, 0.879674, 0.000122265, 0, 0.14674, 0.865668, 0.000125733, 0, 0.166382, 0.850998, 0.000132305, 0, 0.187276, 0.834498, 0.000134844, 0, 0.209413, 0.816903, 0.000139276, 0, 0.232786, 0.798235, 0.000140984, 0, 0.257382, 0.779724, 0.00014378, 0, 0.283181, 0.760251, 0.000144623, 0, 0.310156, 0.739808, 0.000145228, 0, 0.338269, 0.718762, 0.00014539, 0, 0.367461, 0.697815, 0.000144432, 0, 0.397646, 0.67631, 0.000143893, 0, 0.428685, 0.654278, 0.000141846, 0, 0.460318, 0.632347, 0.00013935, 0, 0.492064, 0.610296, 0.000137138, 0, 0.52381, 0.588039, 0.000133806, 0, 0.555556, 0.566218, 0.000130755, 0, 0.587302, 0.544346, 0.000127128, 0, 0.619048, 0.522701, 0.000123002, 0, 0.650794, 0.501542, 0.000119443, 0, 0.68254, 0.480508, 0.000115055, 0, 0.714286, 0.460092, 0.000111032, 0, 0.746032, 0.440021, 0.000106635, 0, 0.777778, 0.420446, 0.000102162, 0, 0.809524, 0.401512, 9.8184e-05, 0, 0.84127, 0.38299, 9.36497e-05, 0, 0.873016, 0.365232, 8.9813e-05, 0, 0.904762, 0.347865, 8.53073e-05, 0, 0.936508, 0.331342, 8.17068e-05, 0, 0.968254, 0.315202, 7.73818e-05, 0, 1, 1, 2.9368e-07, 0, 0, 1, 2.937e-07, 0, 0, 1, 2.93998e-07, 0, 0, 1, 2.95298e-07, 0, 0, 0.999999, 2.98865e-07, 0, 0, 0.999998, 3.067e-07, 0, 0, 0.999995, 3.22082e-07, 0, 0, 0.999992, 3.50767e-07, 0, 0, 0.999986, 4.03538e-07, 0, 0, 0.999976, 5.01372e-07, 0, 0, 0.999964, 6.8562e-07, 0, 0, 0.999945, 1.0374e-06, 0, 0, 0.999919, 1.71269e-06, 0, 0, 0.999882, 3.00175e-06, 0, 0, 0.999829, 5.42144e-06, 0, 0, 0.999749, 9.84182e-06, 0, 0, 0.99962, 1.76213e-05, 0, 0, 0.999382, 3.05995e-05, 0, 1.38418e-05, 0.998751, 4.96686e-05, 0, 0.000389844, 0.995344, 5.10733e-05, 0, 0.00150343, 0.990768, 3.45829e-05, 0, 0.00352451, 0.987464, 3.42841e-05, 0, 0.00655379, 0.983846, 3.99072e-05, 0, 0.0106554, 0.980007, 5.33219e-05, 0, 0.0158723, 0.974494, 6.96992e-05, 0, 0.0222333, 0.96622, 7.76754e-05, 0, 0.029758, 0.956273, 7.47718e-05, 0, 0.0384596, 0.950952, 8.64611e-05, 0, 0.0483473, 0.945215, 0.000100464, 0, 0.0594266, 0.937287, 0.000103729, 0, 0.0717019, 0.928649, 0.000111665, 0, 0.0851752, 0.918791, 0.00012353, 0, 0.0998479, 0.906685, 0.000127115, 0, 0.115721, 0.893706, 0.00013628, 0, 0.132794, 0.879248, 0.000142427, 0, 0.151067, 0.864685, 0.000148091, 0, 0.170538, 0.850032, 0.000153517, 0, 0.191204, 0.833853, 0.000157322, 0, 0.213063, 0.816353, 0.000161086, 0, 0.236107, 0.797834, 0.000164111, 0, 0.260329, 0.778831, 0.000165446, 0, 0.285714, 0.759756, 0.000167492, 0, 0.312243, 0.739419, 0.000166928, 0, 0.339887, 0.718491, 0.000167, 0, 0.368604, 0.697392, 0.000165674, 0, 0.398329, 0.676102, 0.000163815, 0, 0.428961, 0.654243, 0.000162003, 0, 0.460331, 0.632176, 0.000158831, 0, 0.492064, 0.610407, 0.000155463, 0, 0.52381, 0.588394, 0.000152062, 0, 0.555556, 0.56645, 0.000147665, 0, 0.587302, 0.5449, 0.00014375, 0, 0.619048, 0.523276, 0.000138905, 0, 0.650794, 0.502179, 0.000134189, 0, 0.68254, 0.481359, 0.000129392, 0, 0.714286, 0.46092, 0.000124556, 0, 0.746032, 0.441084, 0.00011957, 0, 0.777778, 0.421517, 0.000114652, 0, 0.809524, 0.402721, 0.000109688, 0, 0.84127, 0.384222, 0.000104667, 0, 0.873016, 0.366534, 9.99633e-05, 0, 0.904762, 0.349205, 9.50177e-05, 0, 0.936508, 0.332702, 9.07301e-05, 0, 0.968254, 0.316599, 8.59769e-05, 0, 1, 1, 5.85473e-07, 0, 0, 1, 5.85507e-07, 0, 0, 1, 5.8602e-07, 0, 0, 0.999999, 5.88259e-07, 0, 0, 0.999999, 5.94381e-07, 0, 0, 0.999998, 6.07754e-07, 0, 0, 0.999995, 6.33729e-07, 0, 0, 0.99999, 6.8137e-07, 0, 0, 0.999984, 7.67003e-07, 0, 0, 0.999973, 9.21212e-07, 0, 0, 0.999959, 1.20218e-06, 0, 0, 0.999936, 1.72024e-06, 0, 0, 0.999907, 2.68088e-06, 0, 0, 0.999866, 4.45512e-06, 0, 0, 0.999806, 7.68481e-06, 0, 0, 0.999716, 1.342e-05, 0, 0, 0.999576, 2.32473e-05, 0, 0, 0.9993, 3.91694e-05, 0, 0.000129917, 0.998498, 6.08429e-05, 0, 0.000845035, 0.994132, 4.89743e-05, 0, 0.00237616, 0.99031, 3.84644e-05, 0, 0.00484456, 0.987409, 4.21768e-05, 0, 0.00832472, 0.983981, 5.04854e-05, 0, 0.0128643, 0.980268, 6.71028e-05, 0, 0.0184947, 0.974875, 8.52749e-05, 0, 0.025237, 0.966063, 8.5531e-05, 0, 0.0331046, 0.956779, 9.00588e-05, 0, 0.0421067, 0.950259, 0.00010577, 0, 0.0522487, 0.944239, 0.000119458, 0, 0.0635343, 0.936341, 0.000122164, 0, 0.0759654, 0.928047, 0.000134929, 0, 0.0895434, 0.918065, 0.000145544, 0, 0.104269, 0.906267, 0.000150531, 0, 0.120142, 0.893419, 0.000161652, 0, 0.137163, 0.878758, 0.00016593, 0, 0.15533, 0.863699, 0.000174014, 0, 0.174645, 0.848876, 0.000177877, 0, 0.195106, 0.833032, 0.000184049, 0, 0.21671, 0.815557, 0.000186088, 0, 0.239454, 0.797323, 0.00019054, 0, 0.263332, 0.778124, 0.000191765, 0, 0.288336, 0.758929, 0.000192535, 0, 0.314451, 0.738979, 0.000192688, 0, 0.341658, 0.718213, 0.000191522, 0, 0.369924, 0.696947, 0.000190491, 0, 0.399202, 0.675807, 0.000187913, 0, 0.429416, 0.654147, 0.000184451, 0, 0.460447, 0.63229, 0.000181442, 0, 0.492064, 0.610499, 0.000177139, 0, 0.523809, 0.588747, 0.000172596, 0, 0.555555, 0.566783, 0.000167457, 0, 0.587301, 0.545359, 0.000162518, 0, 0.619048, 0.523984, 0.000156818, 0, 0.650794, 0.502917, 0.000151884, 0, 0.68254, 0.482294, 0.000145514, 0, 0.714286, 0.461945, 0.000140199, 0, 0.746032, 0.442133, 0.000134101, 0, 0.777778, 0.422705, 0.000128374, 0, 0.809524, 0.403916, 0.000122996, 0, 0.84127, 0.38554, 0.000116808, 0, 0.873016, 0.367909, 0.000111973, 0, 0.904762, 0.350651, 0.000105938, 0, 0.936508, 0.334208, 0.000101355, 0, 0.968254, 0.318123, 9.57629e-05, 0, 1, 1, 1.11633e-06, 0, 0, 1, 1.11639e-06, 0, 0, 1, 1.11725e-06, 0, 0, 1, 1.12096e-06, 0, 0, 0.999999, 1.1311e-06, 0, 0, 0.999997, 1.15315e-06, 0, 0, 0.999995, 1.1956e-06, 0, 0, 0.999989, 1.27239e-06, 0, 0, 0.999981, 1.40772e-06, 0, 0, 0.999969, 1.64541e-06, 0, 0, 0.999952, 2.06607e-06, 0, 0, 0.999928, 2.81783e-06, 0, 0, 0.999895, 4.16835e-06, 0, 0, 0.999848, 6.58728e-06, 0, 0, 0.999781, 1.08648e-05, 0, 0, 0.999682, 1.82579e-05, 0, 0, 0.999523, 3.06003e-05, 0, 1.59122e-05, 0.999205, 4.99862e-05, 0, 0.000391184, 0.998131, 7.3306e-05, 0, 0.00147534, 0.993334, 5.13229e-05, 0, 0.0034227, 0.99016, 4.67783e-05, 0, 0.00632232, 0.987321, 5.23413e-05, 0, 0.0102295, 0.984099, 6.4267e-05, 0, 0.0151794, 0.980432, 8.43042e-05, 0, 0.0211947, 0.974976, 0.000102819, 0, 0.0282899, 0.966429, 9.96234e-05, 0, 0.0364739, 0.957633, 0.000111074, 0, 0.0457522, 0.949422, 0.000128644, 0, 0.0561278, 0.943045, 0.000140076, 0, 0.0676023, 0.935448, 0.000146349, 0, 0.0801762, 0.927225, 0.000161854, 0, 0.0938499, 0.917033, 0.000169135, 0, 0.108623, 0.905762, 0.000179987, 0, 0.124496, 0.892879, 0.000189832, 0, 0.141469, 0.878435, 0.000195881, 0, 0.159541, 0.863114, 0.00020466, 0, 0.178713, 0.84776, 0.000209473, 0, 0.198985, 0.832084, 0.000214861, 0, 0.220355, 0.814915, 0.000217695, 0, 0.242823, 0.796711, 0.000220313, 0, 0.266385, 0.777603, 0.00022313, 0, 0.291036, 0.757991, 0.000222471, 0, 0.316767, 0.738371, 0.000222869, 0, 0.343563, 0.717872, 0.000221243, 0, 0.371402, 0.696619, 0.000218089, 0, 0.400248, 0.675379, 0.00021562, 0, 0.430047, 0.65411, 0.00021169, 0, 0.460709, 0.63241, 0.000206947, 0, 0.492079, 0.61046, 0.000201709, 0, 0.52381, 0.58903, 0.000196753, 0, 0.555556, 0.567267, 0.000189637, 0, 0.587302, 0.545886, 0.000184735, 0, 0.619048, 0.524714, 0.000177257, 0, 0.650794, 0.503789, 0.000171424, 0, 0.68254, 0.483204, 0.000164688, 0, 0.714286, 0.462976, 0.000157172, 0, 0.746032, 0.443294, 0.000151341, 0, 0.777778, 0.423988, 0.000143737, 0, 0.809524, 0.405325, 0.000138098, 0, 0.84127, 0.386981, 0.000130698, 0, 0.873016, 0.369436, 0.000125276, 0, 0.904762, 0.35219, 0.000118349, 0, 0.936508, 0.335804, 0.00011312, 0, 0.968254, 0.319749, 0.000106687, 0, 1, 1, 2.04685e-06, 0, 0, 1, 2.04694e-06, 0, 0, 1, 2.04831e-06, 0, 0, 0.999999, 2.05428e-06, 0, 0, 0.999999, 2.07056e-06, 0, 0, 0.999997, 2.10581e-06, 0, 0, 0.999993, 2.1732e-06, 0, 0, 0.999987, 2.29365e-06, 0, 0, 0.999979, 2.50243e-06, 0, 0, 0.999965, 2.86127e-06, 0, 0, 0.999947, 3.48028e-06, 0, 0, 0.999918, 4.55588e-06, 0, 0, 0.999881, 6.43303e-06, 0, 0, 0.999828, 9.70064e-06, 0, 0, 0.999753, 1.53233e-05, 0, 0, 0.999642, 2.4793e-05, 0, 0, 0.999464, 4.02032e-05, 0, 0.000122947, 0.999089, 6.35852e-05, 0, 0.000807414, 0.997567, 8.57026e-05, 0, 0.00227206, 0.992903, 5.94912e-05, 0, 0.00462812, 0.990011, 5.78515e-05, 0, 0.00794162, 0.987192, 6.5399e-05, 0, 0.0122534, 0.98418, 8.19675e-05, 0, 0.0175888, 0.980491, 0.000105514, 0, 0.0239635, 0.974779, 0.000121532, 0, 0.031387, 0.96675, 0.000119144, 0, 0.0398644, 0.958248, 0.000136125, 0, 0.0493982, 0.948884, 0.000155408, 0, 0.0599896, 0.941673, 0.000162281, 0, 0.0716382, 0.934521, 0.000176754, 0, 0.0843437, 0.926205, 0.000192873, 0, 0.0981056, 0.916089, 0.000200038, 0, 0.112923, 0.904963, 0.000213624, 0, 0.128796, 0.892089, 0.000221834, 0, 0.145725, 0.878028, 0.000232619, 0, 0.163709, 0.86249, 0.000238632, 0, 0.182749, 0.846587, 0.000247002, 0, 0.202847, 0.830988, 0.000250702, 0, 0.224001, 0.814165, 0.000255562, 0, 0.246214, 0.796135, 0.000257505, 0, 0.269482, 0.777052, 0.000258625, 0, 0.293805, 0.757201, 0.000258398, 0, 0.319176, 0.737655, 0.000256714, 0, 0.345587, 0.717477, 0.000255187, 0, 0.373021, 0.696433, 0.000251792, 0, 0.401454, 0.675084, 0.000247223, 0, 0.430844, 0.653907, 0.000242213, 0, 0.461125, 0.632561, 0.000237397, 0, 0.492187, 0.610658, 0.000229313, 0, 0.52381, 0.589322, 0.000224402, 0, 0.555556, 0.567857, 0.000216116, 0, 0.587302, 0.54652, 0.000209124, 0, 0.619048, 0.525433, 0.000201601, 0, 0.650794, 0.504679, 0.000192957, 0, 0.68254, 0.484203, 0.000186052, 0, 0.714286, 0.464203, 0.000177672, 0, 0.746032, 0.444549, 0.000170005, 0, 0.777778, 0.425346, 0.000162401, 0, 0.809524, 0.406706, 0.0001544, 0, 0.84127, 0.388576, 0.000147437, 0, 0.873016, 0.37094, 0.000139493, 0, 0.904762, 0.353996, 0.000133219, 0, 0.936508, 0.337391, 0.000125573, 0, 0.968254, 0.321648, 0.000119867, 0, 1, 1, 3.62511e-06, 0, 0, 1, 3.62525e-06, 0, 0, 1, 3.62739e-06, 0, 0, 0.999999, 3.63673e-06, 0, 0, 0.999998, 3.66214e-06, 0, 0, 0.999996, 3.71698e-06, 0, 0, 0.999992, 3.82116e-06, 0, 0, 0.999986, 4.00554e-06, 0, 0, 0.999976, 4.32058e-06, 0, 0, 0.999961, 4.85194e-06, 0, 0, 0.999938, 5.74808e-06, 0, 0, 0.999908, 7.26643e-06, 0, 0, 0.999865, 9.84707e-06, 0, 0, 0.999807, 1.42217e-05, 0, 0, 0.999723, 2.15581e-05, 0, 0, 0.999602, 3.36114e-05, 0, 1.19113e-05, 0.999398, 5.27353e-05, 0, 0.000355813, 0.998946, 8.05809e-05, 0, 0.00137768, 0.996647, 9.42908e-05, 0, 0.00322469, 0.992298, 6.68733e-05, 0, 0.00597897, 0.989802, 7.16564e-05, 0, 0.00968903, 0.987019, 8.21355e-05, 0, 0.0143845, 0.984219, 0.000104555, 0, 0.0200831, 0.980425, 0.000131245, 0, 0.0267948, 0.974241, 0.000139613, 0, 0.034525, 0.967006, 0.000145931, 0, 0.0432757, 0.95893, 0.000167153, 0, 0.0530471, 0.949157, 0.000188146, 0, 0.0638386, 0.94062, 0.000194625, 0, 0.0756487, 0.933509, 0.000213721, 0, 0.0884762, 0.925088, 0.000229616, 0, 0.10232, 0.915178, 0.000239638, 0, 0.117178, 0.904093, 0.000254814, 0, 0.133051, 0.891337, 0.000263685, 0, 0.149939, 0.877326, 0.000274789, 0, 0.167841, 0.861794, 0.000280534, 0, 0.18676, 0.845758, 0.000289534, 0, 0.206696, 0.829792, 0.000294446, 0, 0.22765, 0.813037, 0.000296877, 0, 0.249625, 0.795285, 0.000300217, 0, 0.27262, 0.776323, 0.000299826, 0, 0.296636, 0.756673, 0.000299787, 0, 0.321671, 0.736856, 0.000297867, 0, 0.347718, 0.716883, 0.000294052, 0, 0.374768, 0.696089, 0.000289462, 0, 0.402804, 0.67505, 0.000285212, 0, 0.431796, 0.653509, 0.00027653, 0, 0.461695, 0.63258, 0.000271759, 0, 0.49242, 0.61104, 0.000262811, 0, 0.523822, 0.589567, 0.000255151, 0, 0.555556, 0.568322, 0.000246434, 0, 0.587302, 0.547235, 0.000237061, 0, 0.619048, 0.52616, 0.000228343, 0, 0.650794, 0.505716, 0.000219236, 0, 0.68254, 0.485274, 0.000209595, 0, 0.714286, 0.465411, 0.000201011, 0, 0.746032, 0.445854, 0.00019109, 0, 0.777778, 0.426911, 0.000182897, 0, 0.809524, 0.408222, 0.000173569, 0, 0.84127, 0.390307, 0.000165496, 0, 0.873016, 0.372624, 0.000156799, 0, 0.904762, 0.355804, 0.00014917, 0, 0.936508, 0.33924, 0.000140907, 0, 0.968254, 0.323534, 0.000134062, 0, 1, 1, 6.22487e-06, 0, 0, 1, 6.2251e-06, 0, 0, 1, 6.22837e-06, 0, 0, 0.999999, 6.24259e-06, 0, 0, 0.999998, 6.28127e-06, 0, 0, 0.999996, 6.36451e-06, 0, 0, 0.999991, 6.5218e-06, 0, 0, 0.999984, 6.79782e-06, 0, 0, 0.999973, 7.26361e-06, 0, 0, 0.999955, 8.03644e-06, 0, 0, 0.999931, 9.31397e-06, 0, 0, 0.999896, 1.14299e-05, 0, 0, 0.999847, 1.49402e-05, 0, 0, 0.999784, 2.07461e-05, 0, 0, 0.999692, 3.02493e-05, 0, 0, 0.999554, 4.54957e-05, 0, 9.97275e-05, 0.999326, 6.90762e-05, 0, 0.000724813, 0.998757, 0.000101605, 0, 0.0020972, 0.995367, 9.58745e-05, 0, 0.00432324, 0.99209, 8.32808e-05, 0, 0.00746347, 0.989517, 8.87601e-05, 0, 0.0115534, 0.987008, 0.00010564, 0, 0.0166134, 0.98421, 0.000133179, 0, 0.0226552, 0.98021, 0.000161746, 0, 0.0296838, 0.973676, 0.000161821, 0, 0.0377016, 0.967052, 0.000178635, 0, 0.0467079, 0.959385, 0.000206765, 0, 0.0567013, 0.949461, 0.00022476, 0, 0.0676796, 0.939578, 0.00023574, 0, 0.0796403, 0.932416, 0.00025893, 0, 0.0925812, 0.923759, 0.000271228, 0, 0.106501, 0.914223, 0.000289165, 0, 0.121397, 0.902942, 0.000301156, 0, 0.13727, 0.890419, 0.000313852, 0, 0.15412, 0.876639, 0.000324408, 0, 0.171946, 0.861316, 0.00033249, 0, 0.190751, 0.84496, 0.000338497, 0, 0.210537, 0.828427, 0.000345861, 0, 0.231305, 0.811871, 0.000347863, 0, 0.253057, 0.794397, 0.000350225, 0, 0.275797, 0.775726, 0.000349915, 0, 0.299525, 0.75617, 0.000347297, 0, 0.324242, 0.736091, 0.000344232, 0, 0.349947, 0.716213, 0.000340835, 0, 0.376633, 0.695736, 0.000332369, 0, 0.404289, 0.674961, 0.000327943, 0, 0.432895, 0.653518, 0.000318533, 0, 0.462415, 0.632574, 0.000310391, 0, 0.492788, 0.61134, 0.000300755, 0, 0.523909, 0.590017, 0.000290506, 0, 0.555556, 0.568752, 0.000280446, 0, 0.587302, 0.548061, 0.000269902, 0, 0.619048, 0.52711, 0.000258815, 0, 0.650794, 0.506682, 0.000248481, 0, 0.68254, 0.486524, 0.000237141, 0, 0.714286, 0.466812, 0.000226872, 0, 0.746032, 0.44732, 0.000216037, 0, 0.777778, 0.428473, 0.000205629, 0, 0.809524, 0.409921, 0.000195691, 0, 0.84127, 0.392028, 0.000185457, 0, 0.873016, 0.374606, 0.000176436, 0, 0.904762, 0.357601, 0.000166508, 0, 0.936508, 0.341348, 0.000158385, 0, 0.968254, 0.32542, 0.000149203, 0, 1, 1, 1.03967e-05, 0, 0, 1, 1.0397e-05, 0, 0, 1, 1.04019e-05, 0, 0, 0.999999, 1.04231e-05, 0, 0, 0.999998, 1.04806e-05, 0, 0, 0.999995, 1.06042e-05, 0, 0, 0.999991, 1.08366e-05, 0, 0, 0.999982, 1.12415e-05, 0, 0, 0.999968, 1.19174e-05, 0, 0, 0.99995, 1.30227e-05, 0, 0, 0.999922, 1.48176e-05, 0, 0, 0.999884, 1.77303e-05, 0, 0, 0.99983, 2.24564e-05, 0, 0, 0.999758, 3.00966e-05, 0, 0, 0.999654, 4.23193e-05, 0, 5.49083e-06, 0.999503, 6.14848e-05, 0, 0.000296087, 0.999237, 9.03576e-05, 0, 0.00123144, 0.998491, 0.0001271, 0, 0.00295954, 0.994594, 0.000107754, 0, 0.00555829, 0.99178, 0.000103025, 0, 0.00907209, 0.989265, 0.00011154, 0, 0.0135257, 0.986998, 0.000136296, 0, 0.0189327, 0.984137, 0.000169154, 0, 0.0252993, 0.979798, 0.000196671, 0, 0.0326272, 0.97337, 0.000196678, 0, 0.0409157, 0.967239, 0.000223121, 0, 0.0501623, 0.959543, 0.000253809, 0, 0.0603638, 0.949466, 0.000265972, 0, 0.0715171, 0.939074, 0.000288372, 0, 0.0836187, 0.931118, 0.000310983, 0, 0.0966657, 0.922525, 0.000325561, 0, 0.110656, 0.912983, 0.000345725, 0, 0.125588, 0.901617, 0.0003556, 0, 0.141461, 0.889487, 0.000374012, 0, 0.158275, 0.875787, 0.000383445, 0, 0.176031, 0.860654, 0.000393972, 0, 0.19473, 0.844417, 0.000400311, 0, 0.214374, 0.82741, 0.000405004, 0, 0.234967, 0.810545, 0.000407378, 0, 0.256512, 0.793312, 0.000407351, 0, 0.279011, 0.774847, 0.000406563, 0, 0.302468, 0.755621, 0.000404903, 0, 0.326887, 0.735511, 0.000397486, 0, 0.352266, 0.715435, 0.00039357, 0, 0.378605, 0.695403, 0.000384739, 0, 0.405897, 0.674681, 0.000376108, 0, 0.43413, 0.65359, 0.000365997, 0, 0.463277, 0.632471, 0.000354957, 0, 0.493295, 0.61151, 0.000343593, 0, 0.524106, 0.59064, 0.000331841, 0, 0.555561, 0.569386, 0.000318891, 0, 0.587302, 0.548785, 0.0003072, 0, 0.619048, 0.528146, 0.00029361, 0, 0.650794, 0.507872, 0.000281709, 0, 0.68254, 0.487805, 0.000268627, 0, 0.714286, 0.468196, 0.000255887, 0, 0.746032, 0.448922, 0.000243997, 0, 0.777778, 0.430093, 0.000231662, 0, 0.809524, 0.411845, 0.000220339, 0, 0.84127, 0.393808, 0.000208694, 0, 0.873016, 0.376615, 0.000198045, 0, 0.904762, 0.359655, 0.000187375, 0, 0.936508, 0.343452, 0.000177371, 0, 0.968254, 0.32765, 0.000167525, 0, 1, 1, 1.69351e-05, 0, 0, 1, 1.69356e-05, 0, 0, 1, 1.69427e-05, 0, 0, 0.999999, 1.69736e-05, 0, 0, 0.999998, 1.70575e-05, 0, 0, 0.999995, 1.72372e-05, 0, 0, 0.99999, 1.75739e-05, 0, 0, 0.999979, 1.81568e-05, 0, 0, 0.999966, 1.91206e-05, 0, 0, 0.999944, 2.0677e-05, 0, 0, 0.999912, 2.31644e-05, 0, 0, 0.999869, 2.71268e-05, 0, 0, 0.999811, 3.34272e-05, 0, 0, 0.99973, 4.33979e-05, 0, 0, 0.999617, 5.90083e-05, 0, 6.80315e-05, 0.999445, 8.29497e-05, 0, 0.000612796, 0.999138, 0.000118019, 0, 0.00187408, 0.998095, 0.000156712, 0, 0.00395791, 0.993919, 0.000125054, 0, 0.00692144, 0.991333, 0.000126091, 0, 0.0107962, 0.989226, 0.000144912, 0, 0.0155986, 0.986954, 0.000175737, 0, 0.0213364, 0.983982, 0.000213883, 0, 0.0280114, 0.979128, 0.000234526, 0, 0.0356226, 0.973327, 0.000243725, 0, 0.0441668, 0.967416, 0.0002773, 0, 0.0536399, 0.959729, 0.000308799, 0, 0.0640376, 0.949758, 0.000322447, 0, 0.0753554, 0.939173, 0.000350021, 0, 0.0875893, 0.9296, 0.000370089, 0, 0.100736, 0.921181, 0.000391365, 0, 0.114793, 0.91164, 0.000413636, 0, 0.129759, 0.900435, 0.000427068, 0, 0.145632, 0.888183, 0.000441046, 0, 0.162412, 0.874772, 0.000454968, 0, 0.180101, 0.859566, 0.000461882, 0, 0.1987, 0.843579, 0.000471556, 0, 0.218213, 0.826453, 0.000474335, 0, 0.238641, 0.809164, 0.000477078, 0, 0.259989, 0.792179, 0.00047755, 0, 0.282262, 0.773866, 0.000472573, 0, 0.305464, 0.754944, 0.000469765, 0, 0.329599, 0.735133, 0.000462371, 0, 0.35467, 0.714858, 0.000453674, 0, 0.380678, 0.694829, 0.000443888, 0, 0.407622, 0.674453, 0.000432052, 0, 0.435493, 0.653685, 0.000420315, 0, 0.464275, 0.632666, 0.000406829, 0, 0.493938, 0.611676, 0.000392234, 0, 0.524422, 0.591193, 0.000379208, 0, 0.555624, 0.570145, 0.00036319, 0, 0.587302, 0.549566, 0.000349111, 0, 0.619048, 0.529278, 0.000334166, 0, 0.650794, 0.509026, 0.000318456, 0, 0.68254, 0.489186, 0.00030449, 0, 0.714286, 0.469662, 0.000289051, 0, 0.746032, 0.450691, 0.000275494, 0, 0.777778, 0.431841, 0.000261437, 0, 0.809524, 0.413752, 0.000247846, 0, 0.84127, 0.395951, 0.000235085, 0, 0.873016, 0.378633, 0.000222245, 0, 0.904762, 0.36194, 0.000210533, 0, 0.936508, 0.345599, 0.000198494, 0, 0.968254, 0.329999, 0.000188133, 0, 1, 1, 2.69663e-05, 0, 0, 1, 2.6967e-05, 0, 0, 1, 2.69772e-05, 0, 0, 0.999999, 2.70214e-05, 0, 0, 0.999998, 2.71415e-05, 0, 0, 0.999994, 2.7398e-05, 0, 0, 0.999988, 2.78771e-05, 0, 0, 0.999977, 2.87019e-05, 0, 0, 0.999961, 3.00544e-05, 0, 0, 0.999937, 3.22138e-05, 0, 0, 0.999904, 3.56163e-05, 0, 0, 0.999854, 4.09465e-05, 0, 0, 0.99979, 4.92651e-05, 0, 0, 0.999699, 6.21722e-05, 0, 8.8288e-07, 0.999572, 8.19715e-05, 0, 0.000223369, 0.999381, 0.000111689, 0, 0.00105414, 0.999016, 0.000153862, 0, 0.0026493, 0.997437, 0.000187667, 0, 0.00508608, 0.993545, 0.000155672, 0, 0.00840554, 0.991135, 0.000161455, 0, 0.012629, 0.989157, 0.000188241, 0, 0.0177661, 0.986874, 0.000226229, 0, 0.0238198, 0.983714, 0.000268668, 0, 0.0307887, 0.978301, 0.000277109, 0, 0.0386688, 0.973227, 0.000303446, 0, 0.0474554, 0.967317, 0.000341851, 0, 0.0571428, 0.959477, 0.000370885, 0, 0.0677256, 0.950012, 0.000392753, 0, 0.0791988, 0.939484, 0.00042781, 0, 0.0915576, 0.928135, 0.000443866, 0, 0.104798, 0.919819, 0.000472959, 0, 0.118918, 0.910049, 0.000491551, 0, 0.133915, 0.899181, 0.000512616, 0, 0.149788, 0.886881, 0.000523563, 0, 0.166537, 0.87359, 0.000540183, 0, 0.184164, 0.858613, 0.000547386, 0, 0.202669, 0.842809, 0.000554809, 0, 0.222056, 0.825727, 0.000558316, 0, 0.242329, 0.808086, 0.000557824, 0, 0.263492, 0.790728, 0.000556346, 0, 0.285551, 0.772987, 0.000552672, 0, 0.30851, 0.7541, 0.000543738, 0, 0.332376, 0.734669, 0.000536107, 0, 0.357153, 0.714411, 0.000523342, 0, 0.382845, 0.694196, 0.000512238, 0, 0.409454, 0.674252, 0.000497465, 0, 0.436977, 0.65357, 0.000481096, 0, 0.465404, 0.632999, 0.000467054, 0, 0.494713, 0.611994, 0.000448771, 0, 0.524864, 0.591604, 0.000431889, 0, 0.555779, 0.571134, 0.000415238, 0, 0.587302, 0.550528, 0.000396369, 0, 0.619048, 0.530292, 0.000379477, 0, 0.650794, 0.510364, 0.000361488, 0, 0.68254, 0.490749, 0.000343787, 0, 0.714286, 0.471266, 0.000327822, 0, 0.746032, 0.452462, 0.000310626, 0, 0.777778, 0.433907, 0.000295352, 0, 0.809524, 0.415659, 0.000279179, 0, 0.84127, 0.398138, 0.000264685, 0, 0.873016, 0.380833, 0.000249905, 0, 0.904762, 0.364247, 0.000236282, 0, 0.936508, 0.348041, 0.000222905, 0, 0.968254, 0.332389, 0.000210522, 0, 1, 1, 4.20604e-05, 0, 0, 1, 4.20614e-05, 0, 0, 1, 4.20757e-05, 0, 0, 0.999999, 4.2138e-05, 0, 0, 0.999997, 4.23067e-05, 0, 0, 0.999993, 4.26668e-05, 0, 0, 0.999986, 4.33372e-05, 0, 0, 0.999974, 4.44857e-05, 0, 0, 0.999956, 4.63554e-05, 0, 0, 0.99993, 4.93105e-05, 0, 0, 0.999892, 5.39077e-05, 0, 0, 0.999838, 6.10005e-05, 0, 0, 0.999767, 7.18822e-05, 0, 0, 0.999666, 8.84581e-05, 0, 3.65471e-05, 0.999525, 0.000113398, 0, 0.000485623, 0.999311, 0.000150043, 0, 0.00162096, 0.998865, 0.000200063, 0, 0.00355319, 0.996278, 0.000211014, 0, 0.00633818, 0.992956, 0.000189672, 0, 0.0100043, 0.991017, 0.000210262, 0, 0.0145648, 0.989055, 0.000244292, 0, 0.0200237, 0.986741, 0.000290481, 0, 0.0263798, 0.983288, 0.000334303, 0, 0.033629, 0.977784, 0.000340307, 0, 0.0417652, 0.973037, 0.000377864, 0, 0.0507821, 0.967181, 0.0004239, 0, 0.060673, 0.958971, 0.000443854, 0, 0.0714314, 0.950093, 0.000483039, 0, 0.0830518, 0.939552, 0.000517934, 0, 0.0955288, 0.927678, 0.000539449, 0, 0.108859, 0.918278, 0.000568604, 0, 0.123038, 0.908449, 0.000588505, 0, 0.138065, 0.897713, 0.000612473, 0, 0.153938, 0.885533, 0.000625575, 0, 0.170657, 0.872131, 0.00063854, 0, 0.188224, 0.857517, 0.000647034, 0, 0.20664, 0.841796, 0.00065209, 0, 0.225909, 0.824726, 0.0006544, 0, 0.246035, 0.807297, 0.000655744, 0, 0.267022, 0.789058, 0.000646716, 0, 0.288878, 0.77189, 0.000643898, 0, 0.311607, 0.753082, 0.000629973, 0, 0.335216, 0.7341, 0.000621564, 0, 0.359713, 0.714094, 0.000605171, 0, 0.385103, 0.693839, 0.000588752, 0, 0.41139, 0.673891, 0.000573294, 0, 0.438576, 0.653565, 0.000552682, 0, 0.466656, 0.633326, 0.000533446, 0, 0.495617, 0.612582, 0.000514635, 0, 0.525431, 0.59205, 0.00049303, 0, 0.556041, 0.571918, 0.000471842, 0, 0.587338, 0.551572, 0.000451713, 0, 0.619048, 0.531553, 0.000430049, 0, 0.650794, 0.51175, 0.000410445, 0, 0.68254, 0.49238, 0.000390098, 0, 0.714286, 0.473143, 0.000370033, 0, 0.746032, 0.45423, 0.000351205, 0, 0.777778, 0.435963, 0.000332049, 0, 0.809524, 0.41787, 0.000315021, 0, 0.84127, 0.400387, 0.000297315, 0, 0.873016, 0.383332, 0.000281385, 0, 0.904762, 0.366665, 0.000265397, 0, 0.936508, 0.350633, 0.000250601, 0, 0.968254, 0.334964, 0.00023589, 0, 1, 1, 6.43736e-05, 0, 0, 1, 6.4375e-05, 0, 0, 1, 6.43947e-05, 0, 0, 0.999999, 6.4481e-05, 0, 0, 0.999997, 6.47143e-05, 0, 0, 0.999994, 6.52119e-05, 0, 0, 0.999985, 6.61359e-05, 0, 0, 0.999972, 6.77116e-05, 0, 0, 0.999952, 7.02599e-05, 0, 0, 0.999922, 7.42517e-05, 0, 0, 0.99988, 8.03906e-05, 0, 0, 0.99982, 8.97315e-05, 0, 0, 0.999741, 0.000103838, 0, 0, 0.999629, 0.00012496, 0, 0.000149024, 0.999474, 0.000156161, 0, 0.000861027, 0.999229, 0.000201034, 0, 0.00231198, 0.998662, 0.000259069, 0, 0.00458147, 0.995299, 0.000245439, 0, 0.00770895, 0.992732, 0.00024498, 0, 0.0117126, 0.990847, 0.000273211, 0, 0.0165989, 0.988911, 0.000316492, 0, 0.0223674, 0.98654, 0.00037161, 0, 0.0290135, 0.982636, 0.000410352, 0, 0.0365309, 0.977346, 0.000421756, 0, 0.0449117, 0.972909, 0.000475578, 0, 0.0541481, 0.966821, 0.000522482, 0, 0.0642326, 0.958686, 0.000545008, 0, 0.075158, 0.949754, 0.000589286, 0, 0.0869181, 0.939184, 0.000619995, 0, 0.0995074, 0.927505, 0.000654266, 0, 0.112922, 0.916606, 0.000682362, 0, 0.127157, 0.906707, 0.000704286, 0, 0.142212, 0.895937, 0.000725909, 0, 0.158085, 0.883913, 0.000743939, 0, 0.174776, 0.870642, 0.000755157, 0, 0.192287, 0.856241, 0.000764387, 0, 0.210619, 0.84069, 0.000771032, 0, 0.229775, 0.823728, 0.000765906, 0, 0.249761, 0.806481, 0.000767604, 0, 0.270582, 0.787924, 0.000754385, 0, 0.292243, 0.770588, 0.000749668, 0, 0.314753, 0.751991, 0.000731613, 0, 0.338118, 0.733407, 0.000717655, 0, 0.362347, 0.713688, 0.000700604, 0, 0.387447, 0.693595, 0.000678765, 0, 0.413424, 0.673426, 0.000657042, 0, 0.440284, 0.65359, 0.000635892, 0, 0.468027, 0.633576, 0.000611569, 0, 0.496645, 0.613144, 0.000586011, 0, 0.526122, 0.592711, 0.000563111, 0, 0.556417, 0.572722, 0.000537699, 0, 0.587451, 0.552762, 0.000512556, 0, 0.619048, 0.532985, 0.000489757, 0, 0.650794, 0.513219, 0.000464139, 0, 0.68254, 0.493992, 0.000442193, 0, 0.714286, 0.47509, 0.000418629, 0, 0.746032, 0.456287, 0.000397045, 0, 0.777778, 0.438152, 0.000375504, 0, 0.809524, 0.420294, 0.00035492, 0, 0.84127, 0.402749, 0.000335327, 0, 0.873016, 0.385879, 0.000316422, 0, 0.904762, 0.369352, 0.000298333, 0, 0.936508, 0.353301, 0.000281417, 0, 0.968254, 0.337781, 0.000265203, 0, 1, 1, 9.68267e-05, 0, 0, 1, 9.68284e-05, 0, 0, 1, 9.68556e-05, 0, 0, 0.999999, 9.69733e-05, 0, 0, 0.999997, 9.72913e-05, 0, 0, 0.999993, 9.79688e-05, 0, 0, 0.999984, 9.92239e-05, 0, 0, 0.999969, 0.000101356, 0, 0, 0.999946, 0.000104784, 0, 0, 0.999913, 0.000110111, 0, 0, 0.999868, 0.000118217, 0, 0, 0.999801, 0.000130396, 0, 0, 0.999712, 0.000148523, 0, 1.24907e-05, 0.999589, 0.000175233, 0, 0.000355405, 0.999416, 0.000213999, 0, 0.0013528, 0.999136, 0.000268529, 0, 0.00312557, 0.998367, 0.000333088, 0, 0.00573045, 0.994701, 0.000304757, 0, 0.00919397, 0.992497, 0.000318031, 0, 0.0135261, 0.990608, 0.000353863, 0, 0.0187278, 0.988715, 0.000409044, 0, 0.0247947, 0.986241, 0.000472967, 0, 0.0317196, 0.981696, 0.000495104, 0, 0.039494, 0.977097, 0.000532873, 0, 0.0481087, 0.972583, 0.000594447, 0, 0.0575549, 0.966142, 0.000636867, 0, 0.0678242, 0.95823, 0.000669899, 0, 0.0789089, 0.949677, 0.000719499, 0, 0.0908023, 0.939226, 0.000750584, 0, 0.103499, 0.927501, 0.000793183, 0, 0.116993, 0.915199, 0.00081995, 0, 0.131282, 0.90498, 0.000847654, 0, 0.146364, 0.894243, 0.000868929, 0, 0.162237, 0.882154, 0.000884278, 0, 0.178902, 0.869161, 0.000898108, 0, 0.196358, 0.854751, 0.000901254, 0, 0.21461, 0.839368, 0.00090679, 0, 0.23366, 0.822874, 0.000901541, 0, 0.253512, 0.805514, 0.000897297, 0, 0.274174, 0.78716, 0.000881856, 0, 0.29565, 0.769061, 0.000870032, 0, 0.31795, 0.751, 0.000851719, 0, 0.341081, 0.732614, 0.000830671, 0, 0.365053, 0.713171, 0.000806569, 0, 0.389874, 0.693472, 0.00078338, 0, 0.415553, 0.673528, 0.000756404, 0, 0.442098, 0.653397, 0.000726872, 0, 0.469512, 0.633781, 0.000700494, 0, 0.497794, 0.613877, 0.00067105, 0, 0.526935, 0.593506, 0.000640361, 0, 0.556908, 0.573667, 0.000613502, 0, 0.587657, 0.553932, 0.000583177, 0, 0.61906, 0.534345, 0.000554375, 0, 0.650794, 0.515042, 0.000527811, 0, 0.68254, 0.495674, 0.000499367, 0, 0.714286, 0.477132, 0.00047429, 0, 0.746032, 0.458609, 0.000447726, 0, 0.777778, 0.440354, 0.000424205, 0, 0.809524, 0.422765, 0.000399549, 0, 0.84127, 0.405472, 0.000378315, 0, 0.873016, 0.388482, 0.000355327, 0, 0.904762, 0.372191, 0.000336122, 0, 0.936508, 0.356099, 0.000315247, 0, 0.968254, 0.340737, 0.00029794, 0, 1, 1, 0.000143327, 0, 0, 1, 0.00014333, 0, 0, 1, 0.000143366, 0, 0, 0.999999, 0.000143524, 0, 0, 0.999996, 0.000143952, 0, 0, 0.999991, 0.000144862, 0, 0, 0.999981, 0.000146544, 0, 0, 0.999966, 0.000149391, 0, 0, 0.999941, 0.000153946, 0, 0, 0.999905, 0.000160971, 0, 0, 0.999852, 0.000171562, 0, 0, 0.99978, 0.00018729, 0, 0, 0.999681, 0.000210386, 0, 8.26239e-05, 0.999546, 0.000243906, 0, 0.000664807, 0.999352, 0.000291739, 0, 0.00196192, 0.999027, 0.000357419, 0, 0.00405941, 0.997886, 0.000422349, 0, 0.00699664, 0.99419, 0.000385008, 0, 0.0107896, 0.99214, 0.000409775, 0, 0.0154415, 0.990274, 0.000456418, 0, 0.0209488, 0.988455, 0.000527008, 0, 0.0273037, 0.985804, 0.000597685, 0, 0.0344969, 0.98103, 0.000613124, 0, 0.0425183, 0.976674, 0.000668321, 0, 0.0513575, 0.972021, 0.000736985, 0, 0.0610046, 0.965274, 0.000773789, 0, 0.0714508, 0.958046, 0.000830852, 0, 0.0826877, 0.949333, 0.000875766, 0, 0.0947085, 0.939135, 0.000917088, 0, 0.107507, 0.927119, 0.000952244, 0, 0.121078, 0.91469, 0.000990626, 0, 0.135419, 0.903006, 0.00101304, 0, 0.150526, 0.892368, 0.00103834, 0, 0.166399, 0.880231, 0.00105002, 0, 0.183038, 0.867432, 0.00106331, 0, 0.200443, 0.853208, 0.00106783, 0, 0.218618, 0.837956, 0.00106458, 0, 0.237566, 0.821772, 0.00105945, 0, 0.257291, 0.804328, 0.00104685, 0, 0.2778, 0.786465, 0.00103178, 0, 0.2991, 0.768004, 0.00101077, 0, 0.321199, 0.74972, 0.000985504, 0, 0.344106, 0.731682, 0.000962893, 0, 0.36783, 0.712813, 0.000932146, 0, 0.392383, 0.693139, 0.00089871, 0, 0.417774, 0.673566, 0.000869678, 0, 0.444013, 0.653483, 0.000835525, 0, 0.471107, 0.633891, 0.000799853, 0, 0.49906, 0.614433, 0.000766838, 0, 0.527869, 0.594586, 0.000732227, 0, 0.557517, 0.574769, 0.000696442, 0, 0.587966, 0.555149, 0.000663935, 0, 0.61913, 0.535898, 0.000629826, 0, 0.650794, 0.516753, 0.000596486, 0, 0.68254, 0.497816, 0.000567078, 0, 0.714286, 0.479034, 0.000534399, 0, 0.746032, 0.460975, 0.000507013, 0, 0.777778, 0.442935, 0.000477421, 0, 0.809524, 0.425263, 0.000451101, 0, 0.84127, 0.408248, 0.000424964, 0, 0.873016, 0.391339, 0.00039993, 0, 0.904762, 0.37513, 0.000377619, 0, 0.936508, 0.359172, 0.000354418, 0, 0.968254, 0.343876, 0.000334823, 0, 1, 1, 0.000209042, 0, 0, 1, 0.000209045, 0, 0, 1, 0.000209093, 0, 0, 0.999999, 0.000209304, 0, 0, 0.999996, 0.000209871, 0, 0, 0.999991, 0.000211078, 0, 0, 0.999979, 0.000213304, 0, 0, 0.999963, 0.000217061, 0, 0, 0.999933, 0.000223042, 0, 0, 0.999894, 0.000232206, 0, 0, 0.999837, 0.000245901, 0, 0, 0.999756, 0.000266023, 0, 1.02927e-06, 0.999648, 0.000295204, 0, 0.000233468, 0.999499, 0.000336958, 0, 0.00108237, 0.999283, 0.000395563, 0, 0.00268832, 0.998896, 0.000473785, 0, 0.00511138, 0.997006, 0.000520008, 0, 0.00837705, 0.993819, 0.000497261, 0, 0.0124928, 0.991632, 0.000523722, 0, 0.0174561, 0.989875, 0.000587258, 0, 0.0232596, 0.988109, 0.000676329, 0, 0.0298932, 0.985155, 0.000747701, 0, 0.0373453, 0.980479, 0.000768803, 0, 0.0456045, 0.976271, 0.000841054, 0, 0.0546593, 0.971347, 0.000911469, 0, 0.0644994, 0.964528, 0.000953057, 0, 0.0751152, 0.957632, 0.00102221, 0, 0.0864981, 0.948681, 0.00106122, 0, 0.0986407, 0.938716, 0.00111857, 0, 0.111537, 0.926629, 0.00114762, 0, 0.125182, 0.914025, 0.00118995, 0, 0.139571, 0.901026, 0.00121228, 0, 0.154703, 0.890358, 0.00123946, 0, 0.170576, 0.878283, 0.0012527, 0, 0.18719, 0.865459, 0.00125536, 0, 0.204547, 0.851407, 0.00126134, 0, 0.222648, 0.836276, 0.00124759, 0, 0.241498, 0.820436, 0.00124443, 0, 0.261101, 0.803253, 0.00122071, 0, 0.281465, 0.785562, 0.00120107, 0, 0.302595, 0.76718, 0.00117762, 0, 0.324501, 0.748551, 0.00114289, 0, 0.347192, 0.730564, 0.00110872, 0, 0.370679, 0.712253, 0.00107636, 0, 0.394973, 0.692867, 0.00103646, 0, 0.420085, 0.673695, 0.000996793, 0, 0.446027, 0.653912, 0.00095675, 0, 0.47281, 0.634129, 0.000916739, 0, 0.500441, 0.615004, 0.000874401, 0, 0.528921, 0.595587, 0.000833411, 0, 0.558244, 0.575965, 0.000794556, 0, 0.588384, 0.5566, 0.00075196, 0, 0.619281, 0.537428, 0.000716381, 0, 0.650795, 0.518623, 0.000676558, 0, 0.68254, 0.499964, 0.00064074, 0, 0.714286, 0.481356, 0.000605984, 0, 0.746032, 0.463279, 0.000570256, 0, 0.777778, 0.445673, 0.000540138, 0, 0.809524, 0.428032, 0.000507299, 0, 0.84127, 0.411112, 0.000479553, 0, 0.873016, 0.394444, 0.000450737, 0, 0.904762, 0.378247, 0.000424269, 0, 0.936508, 0.362415, 0.000399111, 0, 0.968254, 0.347103, 0.000375274, 0, 1, 1, 0.000300729, 0, 0, 1, 0.000300733, 0, 0, 1, 0.000300797, 0, 0, 0.999998, 0.000301072, 0, 0, 0.999996, 0.000301817, 0, 0, 0.999989, 0.000303398, 0, 0, 0.999977, 0.000306309, 0, 0, 0.999958, 0.000311209, 0, 0, 0.999927, 0.000318975, 0, 0, 0.999884, 0.000330804, 0, 0, 0.99982, 0.00034834, 0, 0, 0.999733, 0.000373854, 0, 3.26995e-05, 0.999613, 0.000410424, 0, 0.000477174, 0.999447, 0.000462047, 0, 0.00161099, 0.999204, 0.000533322, 0, 0.00353153, 0.998725, 0.000624964, 0, 0.00627965, 0.995871, 0.000631786, 0, 0.0098693, 0.993194, 0.000632017, 0, 0.0143011, 0.991541, 0.00068923, 0, 0.019568, 0.989773, 0.000766892, 0, 0.0256593, 0.987647, 0.000863668, 0, 0.0325625, 0.984193, 0.000922089, 0, 0.0402647, 0.980016, 0.000970749, 0, 0.0487532, 0.975859, 0.00106027, 0, 0.058016, 0.970514, 0.00112239, 0, 0.0680419, 0.963625, 0.00117212, 0, 0.0788208, 0.956959, 0.00125211, 0, 0.0903439, 0.947956, 0.00129411, 0, 0.102604, 0.93809, 0.00135879, 0, 0.115594, 0.92659, 0.00139309, 0, 0.129309, 0.913829, 0.00143253, 0, 0.143745, 0.90005, 0.00145809, 0, 0.158901, 0.888129, 0.0014748, 0, 0.174774, 0.87607, 0.00148756, 0, 0.191365, 0.863461, 0.00148714, 0, 0.208674, 0.849594, 0.00148892, 0, 0.226705, 0.834531, 0.00146496, 0, 0.245461, 0.81903, 0.0014579, 0, 0.264947, 0.802122, 0.00143039, 0, 0.28517, 0.78445, 0.00139717, 0, 0.306137, 0.766434, 0.00136312, 0, 0.327857, 0.747816, 0.00132597, 0, 0.350341, 0.729519, 0.00128323, 0, 0.373598, 0.711454, 0.00123803, 0, 0.397642, 0.692699, 0.00119097, 0, 0.422485, 0.673723, 0.00114565, 0, 0.448139, 0.654386, 0.00109552, 0, 0.474619, 0.634673, 0.00104553, 0, 0.501933, 0.615554, 0.00099985, 0, 0.530089, 0.596462, 0.000948207, 0, 0.559087, 0.577385, 0.000902299, 0, 0.588913, 0.558257, 0.000856448, 0, 0.619525, 0.5392, 0.000810395, 0, 0.650826, 0.520543, 0.000768558, 0, 0.68254, 0.502206, 0.0007239, 0, 0.714286, 0.48402, 0.000685794, 0, 0.746032, 0.465779, 0.00064471, 0, 0.777778, 0.448455, 0.000609583, 0, 0.809524, 0.431091, 0.00057227, 0, 0.84127, 0.414147, 0.00054042, 0, 0.873016, 0.39765, 0.000506545, 0, 0.904762, 0.381576, 0.000477635, 0, 0.936508, 0.365881, 0.000448446, 0, 0.968254, 0.350582, 0.000421424, 0, 1, 1, 0.000427144, 0, 0, 1, 0.000427151, 0, 0, 1, 0.000427232, 0, 0, 0.999998, 0.00042759, 0, 0, 0.999995, 0.000428555, 0, 0, 0.999988, 0.000430603, 0, 0, 0.999976, 0.000434368, 0, 0, 0.999952, 0.000440688, 0, 0, 0.999919, 0.000450667, 0, 0, 0.999871, 0.00046578, 0, 0, 0.999801, 0.000488024, 0, 0, 0.999704, 0.000520092, 0, 0.000129791, 0.999572, 0.000565553, 0, 0.000821056, 0.999389, 0.000628906, 0, 0.00225241, 0.999114, 0.000714911, 0, 0.00449109, 0.998488, 0.000819218, 0, 0.00756249, 0.995234, 0.00080415, 0, 0.0114716, 0.993021, 0.000830181, 0, 0.0162131, 0.991407, 0.000902645, 0, 0.021776, 0.989625, 0.000996934, 0, 0.0281471, 0.987064, 0.00109707, 0, 0.0353118, 0.983265, 0.00114353, 0, 0.0432562, 0.979535, 0.0012272, 0, 0.0519665, 0.975224, 0.00132642, 0, 0.0614298, 0.969574, 0.00138092, 0, 0.0716348, 0.963021, 0.00145896, 0, 0.0825709, 0.956046, 0.00152834, 0, 0.094229, 0.947136, 0.00158217, 0, 0.106602, 0.937313, 0.0016347, 0, 0.119682, 0.926073, 0.00168383, 0, 0.133465, 0.913121, 0.00171627, 0, 0.147947, 0.899165, 0.00174229, 0, 0.163125, 0.885891, 0.00176137, 0, 0.178998, 0.873783, 0.00176406, 0, 0.195566, 0.861331, 0.00176156, 0, 0.21283, 0.847569, 0.00175346, 0, 0.230793, 0.832785, 0.00172753, 0, 0.249459, 0.817442, 0.00170204, 0, 0.268832, 0.800613, 0.00166576, 0, 0.28892, 0.783597, 0.00162909, 0, 0.30973, 0.76571, 0.0015826, 0, 0.331271, 0.747021, 0.00153106, 0, 0.353554, 0.728593, 0.00148036, 0, 0.37659, 0.710661, 0.00142808, 0, 0.400391, 0.692426, 0.00136906, 0, 0.424973, 0.673623, 0.00131066, 0, 0.450347, 0.65494, 0.00125569, 0, 0.476531, 0.635448, 0.00119517, 0, 0.503535, 0.616221, 0.00113828, 0, 0.531372, 0.597531, 0.0010816, 0, 0.560047, 0.578795, 0.00102673, 0, 0.589554, 0.559892, 0.000970985, 0, 0.619869, 0.541307, 0.000919773, 0, 0.650923, 0.522608, 0.000868479, 0, 0.68254, 0.504484, 0.00082137, 0, 0.714286, 0.486603, 0.000772916, 0, 0.746032, 0.468802, 0.000730353, 0, 0.777778, 0.451172, 0.000684955, 0, 0.809524, 0.434348, 0.000647565, 0, 0.84127, 0.417445, 0.000605863, 0, 0.873016, 0.401077, 0.000571885, 0, 0.904762, 0.385039, 0.000536034, 0, 0.936508, 0.369483, 0.000504227, 0, 0.968254, 0.354272, 0.000473165, 0, 1, 1, 0.000599525, 0, 0, 1, 0.000599533, 0, 0, 1, 0.000599639, 0, 0, 0.999998, 0.000600097, 0, 0, 0.999994, 0.000601336, 0, 0, 0.999987, 0.000603958, 0, 0, 0.999972, 0.000608775, 0, 0, 0.999949, 0.000616842, 0, 0, 0.999912, 0.000629534, 0, 0, 0.999857, 0.000648658, 0, 0, 0.999781, 0.000676615, 0, 5.38873e-06, 0.999674, 0.000716574, 0, 0.000308602, 0.999528, 0.000772641, 0, 0.00127003, 0.999326, 0.000849806, 0, 0.00300783, 0.999009, 0.000952682, 0, 0.00556637, 0.998112, 0.00106394, 0, 0.00895889, 0.994496, 0.00102228, 0, 0.0131827, 0.992806, 0.00108586, 0, 0.0182277, 0.991211, 0.0011759, 0, 0.0240795, 0.989415, 0.00128955, 0, 0.030723, 0.986499, 0.00139038, 0, 0.0381418, 0.982679, 0.00144539, 0, 0.046321, 0.978839, 0.00153954, 0, 0.0552459, 0.974295, 0.00164417, 0, 0.0649034, 0.968784, 0.00171517, 0, 0.0752814, 0.962324, 0.00180282, 0, 0.0863693, 0.954956, 0.00186387, 0, 0.0981578, 0.94624, 0.00193817, 0, 0.110639, 0.936517, 0.00198156, 0, 0.123806, 0.925186, 0.00203042, 0, 0.137655, 0.91252, 0.0020664, 0, 0.15218, 0.898441, 0.00207822, 0, 0.16738, 0.884394, 0.0020992, 0, 0.183253, 0.871273, 0.00208748, 0, 0.199799, 0.859057, 0.00208686, 0, 0.21702, 0.845243, 0.00205519, 0, 0.234918, 0.830723, 0.00202868, 0, 0.253496, 0.815801, 0.00199501, 0, 0.272761, 0.79914, 0.00194193, 0, 0.292719, 0.782372, 0.00188824, 0, 0.313377, 0.76482, 0.00183695, 0, 0.334745, 0.746586, 0.00177418, 0, 0.356833, 0.7281, 0.00170628, 0, 0.379654, 0.709842, 0.00164063, 0, 0.403221, 0.692019, 0.00157355, 0, 0.427548, 0.67364, 0.00150262, 0, 0.452651, 0.655277, 0.00143473, 0, 0.478545, 0.636438, 0.00136371, 0, 0.505246, 0.617364, 0.00129911, 0, 0.532768, 0.598603, 0.00123014, 0, 0.561122, 0.580195, 0.00116587, 0, 0.590309, 0.561786, 0.00110398, 0, 0.620318, 0.543377, 0.00104148, 0, 0.651102, 0.525093, 0.000983984, 0, 0.682545, 0.506791, 0.00092667, 0, 0.714286, 0.489291, 0.000874326, 0, 0.746032, 0.471811, 0.000821734, 0, 0.777778, 0.454435, 0.000774698, 0, 0.809524, 0.437493, 0.000727302, 0, 0.84127, 0.420977, 0.000684039, 0, 0.873016, 0.404729, 0.00064373, 0, 0.904762, 0.388756, 0.00060285, 0, 0.936508, 0.373344, 0.00056765, 0, 0.968254, 0.358191, 0.000531929, 0, 1, 1, 0.000832169, 0, 0, 1, 0.000832178, 0, 0, 1, 0.00083231, 0, 0, 0.999998, 0.000832893, 0, 0, 0.999995, 0.000834465, 0, 0, 0.999985, 0.000837791, 0, 0, 0.999969, 0.000843893, 0, 0, 0.999944, 0.000854086, 0, 0, 0.999903, 0.000870071, 0, 0, 0.999843, 0.000894042, 0, 0, 0.999759, 0.000928865, 0, 5.31805e-05, 0.999643, 0.000978242, 0, 0.000579365, 0.99948, 0.00104684, 0, 0.00182774, 0.999255, 0.00114012, 0, 0.00387804, 0.998885, 0.00126188, 0, 0.00675709, 0.997405, 0.00135888, 0, 0.010468, 0.99424, 0.00133626, 0, 0.0150018, 0.992458, 0.00140905, 0, 0.0203443, 0.990929, 0.00152305, 0, 0.0264786, 0.989116, 0.00165882, 0, 0.0333875, 0.985624, 0.00174128, 0, 0.0410536, 0.982003, 0.00182108, 0, 0.0494609, 0.978336, 0.00194498, 0, 0.0585941, 0.973184, 0.00202708, 0, 0.0684396, 0.9678, 0.00212166, 0, 0.0789851, 0.961348, 0.00221366, 0, 0.0902199, 0.953841, 0.00228219, 0, 0.102134, 0.94534, 0.00235662, 0, 0.114721, 0.935552, 0.00240572, 0, 0.127972, 0.924064, 0.00244405, 0, 0.141884, 0.911827, 0.00247557, 0, 0.156451, 0.897731, 0.00248374, 0, 0.171672, 0.883409, 0.00249863, 0, 0.187545, 0.868625, 0.00246688, 0, 0.20407, 0.856529, 0.00246523, 0, 0.221249, 0.842999, 0.00242368, 0, 0.239083, 0.828505, 0.00237354, 0, 0.257578, 0.813825, 0.00232588, 0, 0.276738, 0.797813, 0.00226731, 0, 0.296569, 0.781097, 0.00219704, 0, 0.31708, 0.764038, 0.00212394, 0, 0.338281, 0.746067, 0.00204786, 0, 0.360181, 0.727687, 0.00196728, 0, 0.382794, 0.709571, 0.00188779, 0, 0.406133, 0.691503, 0.00180532, 0, 0.430213, 0.673673, 0.00171849, 0, 0.45505, 0.655732, 0.00164147, 0, 0.480662, 0.637399, 0.00155858, 0, 0.507065, 0.618616, 0.00147641, 0, 0.534278, 0.60005, 0.00140125, 0, 0.562313, 0.581713, 0.00132441, 0, 0.59118, 0.563546, 0.00125014, 0, 0.620875, 0.545605, 0.00118249, 0, 0.651373, 0.527559, 0.0011116, 0, 0.682593, 0.509764, 0.00104979, 0, 0.714286, 0.49193, 0.000985977, 0, 0.746032, 0.475011, 0.000928592, 0, 0.777778, 0.457878, 0.000873466, 0, 0.809524, 0.440979, 0.000819585, 0, 0.84127, 0.424613, 0.000772365, 0, 0.873016, 0.408549, 0.000722195, 0, 0.904762, 0.392771, 0.000680014, 0, 0.936508, 0.377317, 0.000636797, 0, 0.968254, 0.362352, 0.000598318, 0, 1, 1, 0.00114313, 0, 0, 1, 0.00114314, 0, 0, 0.999999, 0.00114331, 0, 0, 0.999998, 0.00114404, 0, 0, 0.999994, 0.00114601, 0, 0, 0.999984, 0.00115019, 0, 0, 0.999967, 0.00115784, 0, 0, 0.999937, 0.0011706, 0, 0, 0.999894, 0.00119054, 0, 0, 0.999828, 0.00122031, 0, 0, 0.999735, 0.00126331, 0, 0.000169263, 0.999606, 0.00132382, 0, 0.000949167, 0.999426, 0.0014071, 0, 0.00249668, 0.999173, 0.00151895, 0, 0.00486392, 0.99873, 0.00166102, 0, 0.00806323, 0.996243, 0.0017023, 0, 0.0120895, 0.993779, 0.00172782, 0, 0.0169288, 0.9919, 0.0018108, 0, 0.0225633, 0.990524, 0.00196028, 0, 0.028974, 0.98868, 0.00212014, 0, 0.036142, 0.984663, 0.00217598, 0, 0.044049, 0.981457, 0.00230563, 0, 0.0526781, 0.977608, 0.00243966, 0, 0.0620137, 0.972215, 0.00251336, 0, 0.0720418, 0.966798, 0.0026285, 0, 0.0827499, 0.960241, 0.00271409, 0, 0.0941271, 0.952489, 0.00278381, 0, 0.106164, 0.944127, 0.00285399, 0, 0.118852, 0.934282, 0.00290994, 0, 0.132185, 0.923271, 0.00294558, 0, 0.146157, 0.910803, 0.00296269, 0, 0.160766, 0.896705, 0.00296803, 0, 0.176007, 0.88238, 0.00296637, 0, 0.19188, 0.867116, 0.00293163, 0, 0.208385, 0.853636, 0.00289418, 0, 0.225523, 0.840469, 0.00284663, 0, 0.243296, 0.82639, 0.00278594, 0, 0.261709, 0.811759, 0.00271618, 0, 0.280767, 0.796113, 0.00263187, 0, 0.300476, 0.779518, 0.00254589, 0, 0.320845, 0.763142, 0.00246003, 0, 0.341883, 0.745464, 0.00236529, 0, 0.363601, 0.727491, 0.00226536, 0, 0.386011, 0.709414, 0.00216375, 0, 0.409128, 0.691396, 0.00207127, 0, 0.432967, 0.67368, 0.00197106, 0, 0.457545, 0.656049, 0.00187022, 0, 0.482881, 0.638188, 0.00177605, 0, 0.508992, 0.620177, 0.00168482, 0, 0.535899, 0.601506, 0.00158909, 0, 0.563619, 0.58362, 0.00150583, 0, 0.592165, 0.565496, 0.00141791, 0, 0.621544, 0.54789, 0.00133693, 0, 0.651743, 0.530323, 0.00126038, 0, 0.682709, 0.512795, 0.00118556, 0, 0.714286, 0.495199, 0.00111527, 0, 0.746032, 0.478101, 0.0010489, 0, 0.777778, 0.461511, 0.000984264, 0, 0.809524, 0.444879, 0.00092591, 0, 0.84127, 0.428424, 0.000866582, 0, 0.873016, 0.412495, 0.000814463, 0, 0.904762, 0.396975, 0.000764498, 0, 0.936508, 0.381614, 0.000715967, 0, 0.968254, 0.366732, 0.000672483, 0, 1, 1, 0.00155501, 0, 0, 1, 0.00155503, 0, 0, 1, 0.00155524, 0, 0, 0.999998, 0.00155615, 0, 0, 0.999994, 0.0015586, 0, 0, 0.999983, 0.00156379, 0, 0, 0.999963, 0.0015733, 0, 0, 0.999932, 0.00158911, 0, 0, 0.999882, 0.00161376, 0, 0, 0.99981, 0.00165041, 0, 1.00875e-05, 0.999708, 0.00170304, 0, 0.000367658, 0.999565, 0.00177658, 0, 0.0014234, 0.999368, 0.00187688, 0, 0.00327939, 0.999081, 0.00200989, 0, 0.00596629, 0.99852, 0.00217177, 0, 0.0094852, 0.99549, 0.0021745, 0, 0.013824, 0.993252, 0.00222357, 0, 0.0189642, 0.991727, 0.00235022, 0, 0.0248856, 0.989951, 0.00250561, 0, 0.0315669, 0.988029, 0.00268829, 0, 0.0389882, 0.984029, 0.0027496, 0, 0.0471302, 0.980683, 0.00289793, 0, 0.0559754, 0.976554, 0.00303315, 0, 0.0655081, 0.97139, 0.00313257, 0, 0.0757138, 0.965544, 0.00323656, 0, 0.08658, 0.95912, 0.00333432, 0, 0.0980954, 0.951183, 0.0034039, 0, 0.110251, 0.942974, 0.00347515, 0, 0.123038, 0.932642, 0.00350381, 0, 0.13645, 0.922158, 0.00354519, 0, 0.150482, 0.909404, 0.00353851, 0, 0.165129, 0.896071, 0.0035435, 0, 0.18039, 0.881206, 0.00349936, 0, 0.196263, 0.866077, 0.00347256, 0, 0.212748, 0.85093, 0.003415, 0, 0.229847, 0.837703, 0.00333367, 0, 0.247561, 0.823878, 0.003249, 0, 0.265895, 0.809449, 0.00316347, 0, 0.284854, 0.794379, 0.00306351, 0, 0.304445, 0.778138, 0.0029499, 0, 0.324675, 0.761997, 0.00284099, 0, 0.345555, 0.744938, 0.00272104, 0, 0.367095, 0.727212, 0.00260715, 0, 0.389309, 0.709549, 0.00248855, 0, 0.41221, 0.691704, 0.00236783, 0, 0.435814, 0.673689, 0.00225178, 0, 0.460138, 0.656453, 0.00213765, 0, 0.485203, 0.639128, 0.00202178, 0, 0.511028, 0.621512, 0.00191443, 0, 0.537634, 0.603598, 0.00180977, 0, 0.565041, 0.58559, 0.00170456, 0, 0.593268, 0.567852, 0.00160927, 0, 0.622327, 0.5503, 0.00151395, 0, 0.652217, 0.533033, 0.00142499, 0, 0.682907, 0.515942, 0.00133955, 0, 0.714296, 0.498814, 0.0012602, 0, 0.746032, 0.481595, 0.00118188, 0, 0.777778, 0.465117, 0.00111171, 0, 0.809524, 0.448865, 0.00104091, 0, 0.84127, 0.432711, 0.000976618, 0, 0.873016, 0.416822, 0.00091859, 0, 0.904762, 0.401272, 0.000857704, 0, 0.936508, 0.386226, 0.000807172, 0, 0.968254, 0.371321, 0.00075464, 0, 1, 1, 0.00209596, 0, 0, 1, 0.00209598, 0, 0, 1, 0.00209624, 0, 0, 0.999997, 0.00209736, 0, 0, 0.999991, 0.00210039, 0, 0, 0.999979, 0.00210678, 0, 0, 0.999959, 0.00211847, 0, 0, 0.999925, 0.0021379, 0, 0, 0.99987, 0.00216809, 0, 0, 0.999791, 0.00221281, 0, 6.81487e-05, 0.999677, 0.00227669, 0, 0.000658161, 0.999521, 0.00236533, 0, 0.00200635, 0.999301, 0.00248514, 0, 0.0041779, 0.998977, 0.00264185, 0, 0.00718648, 0.998191, 0.00281695, 0, 0.0110239, 0.994801, 0.00278518, 0, 0.015672, 0.993091, 0.00288774, 0, 0.0211091, 0.991571, 0.00303931, 0, 0.0273123, 0.9897, 0.00321643, 0, 0.034259, 0.987023, 0.00337332, 0, 0.0419282, 0.983289, 0.00346146, 0, 0.0502998, 0.979892, 0.00363704, 0, 0.0593562, 0.975111, 0.00373601, 0, 0.069081, 0.970351, 0.0038842, 0, 0.0794598, 0.964131, 0.00397053, 0, 0.0904798, 0.957747, 0.00408078, 0, 0.10213, 0.949536, 0.00413533, 0, 0.1144, 0.941372, 0.00420305, 0, 0.127284, 0.931049, 0.00422815, 0, 0.140772, 0.920647, 0.00425048, 0, 0.154862, 0.908033, 0.0042281, 0, 0.169548, 0.895028, 0.00422026, 0, 0.184828, 0.879968, 0.00415042, 0, 0.200701, 0.864875, 0.00408821, 0, 0.217167, 0.84918, 0.00400909, 0, 0.234227, 0.834934, 0.00391178, 0, 0.251884, 0.821397, 0.00380066, 0, 0.270141, 0.807135, 0.00367974, 0, 0.289004, 0.792363, 0.00355172, 0, 0.308479, 0.776661, 0.003411, 0, 0.328575, 0.760705, 0.00328123, 0, 0.349301, 0.744408, 0.00314003, 0, 0.370668, 0.726994, 0.0029906, 0, 0.392689, 0.709598, 0.00285034, 0, 0.415379, 0.692112, 0.00271179, 0, 0.438754, 0.674435, 0.00257185, 0, 0.46283, 0.65676, 0.00243425, 0, 0.48763, 0.639982, 0.00230351, 0, 0.513173, 0.622983, 0.0021777, 0, 0.539482, 0.605471, 0.00204991, 0, 0.566579, 0.58796, 0.00193759, 0, 0.594488, 0.570463, 0.00181976, 0, 0.623226, 0.553058, 0.00171497, 0, 0.6528, 0.535894, 0.00161109, 0, 0.683198, 0.519089, 0.00151394, 0, 0.714354, 0.502454, 0.00142122, 0, 0.746032, 0.485681, 0.00133488, 0, 0.777778, 0.468935, 0.00124975, 0, 0.809524, 0.452951, 0.00117309, 0, 0.84127, 0.437139, 0.00110155, 0, 0.873016, 0.421446, 0.00103124, 0, 0.904762, 0.405951, 0.000966387, 0, 0.936508, 0.391003, 0.000908119, 0, 0.968254, 0.376198, 0.000848057, 0, 1, 1, 0.00280076, 0, 0, 1, 0.00280078, 0, 0, 0.999999, 0.00280109, 0, 0, 0.999997, 0.00280246, 0, 0, 0.999992, 0.00280616, 0, 0, 0.999979, 0.00281396, 0, 0, 0.999956, 0.00282822, 0, 0, 0.999916, 0.00285186, 0, 0, 0.999857, 0.0028885, 0, 0, 0.999768, 0.00294259, 0, 0.000196026, 0.999645, 0.00301946, 0, 0.00104842, 0.99947, 0.00312541, 0, 0.00270199, 0.999229, 0.00326733, 0, 0.00519449, 0.998852, 0.00344992, 0, 0.00852602, 0.997558, 0.00361052, 0, 0.0126804, 0.994417, 0.0035898, 0, 0.017635, 0.992824, 0.00372393, 0, 0.023365, 0.991344, 0.00390695, 0, 0.0298456, 0.989337, 0.00410392, 0, 0.0370529, 0.985811, 0.00420987, 0, 0.0449651, 0.982772, 0.00437488, 0, 0.0535615, 0.979001, 0.00455069, 0, 0.0628243, 0.974102, 0.00464462, 0, 0.0727368, 0.969197, 0.00480577, 0, 0.0832844, 0.962759, 0.00487818, 0, 0.0944545, 0.956207, 0.00498176, 0, 0.106236, 0.947909, 0.00503392, 0, 0.118619, 0.939596, 0.00507474, 0, 0.131595, 0.929642, 0.00509798, 0, 0.145159, 0.918807, 0.00508476, 0, 0.159305, 0.906921, 0.00505634, 0, 0.174028, 0.893312, 0.00498845, 0, 0.189327, 0.878933, 0.0049133, 0, 0.2052, 0.863986, 0.0048259, 0, 0.221647, 0.847936, 0.00470848, 0, 0.23867, 0.832253, 0.00456889, 0, 0.25627, 0.818619, 0.00442726, 0, 0.274453, 0.804788, 0.00427677, 0, 0.293222, 0.790241, 0.00411906, 0, 0.312585, 0.775162, 0.00394833, 0, 0.33255, 0.759463, 0.00377366, 0, 0.353126, 0.743598, 0.00361026, 0, 0.374324, 0.72697, 0.00343627, 0, 0.396158, 0.709646, 0.00326422, 0, 0.418641, 0.69277, 0.00309717, 0, 0.44179, 0.675371, 0.0029356, 0, 0.465624, 0.657863, 0.00277712, 0, 0.490163, 0.640772, 0.00261738, 0, 0.515429, 0.624441, 0.0024737, 0, 0.541445, 0.607497, 0.00233125, 0, 0.568236, 0.590438, 0.00218994, 0, 0.595828, 0.573224, 0.0020664, 0, 0.624242, 0.556168, 0.00193526, 0, 0.653496, 0.539232, 0.00182463, 0, 0.683588, 0.522352, 0.00170735, 0, 0.714482, 0.506172, 0.00160555, 0, 0.746032, 0.489842, 0.00150451, 0, 0.777778, 0.473463, 0.00140938, 0, 0.809524, 0.457266, 0.00132568, 0, 0.84127, 0.441609, 0.0012376, 0, 0.873016, 0.426348, 0.00116265, 0, 0.904762, 0.411002, 0.00108935, 0, 0.936508, 0.396045, 0.00101946, 0, 0.968254, 0.381448, 0.000955665, 0, 1, 1, 0.0037121, 0, 0, 1, 0.00371213, 0, 0, 1, 0.00371251, 0, 0, 0.999997, 0.00371417, 0, 0, 0.99999, 0.00371863, 0, 0, 0.999977, 0.00372807, 0, 0, 0.99995, 0.00374529, 0, 0, 0.999908, 0.0037738, 0, 0, 0.999843, 0.00381789, 0, 1.23596e-05, 0.999745, 0.00388273, 0, 0.000407442, 0.999608, 0.00397443, 0, 0.0015447, 0.999415, 0.00409998, 0, 0.00351385, 0.999143, 0.00426662, 0, 0.0063316, 0.9987, 0.00447625, 0, 0.00998679, 0.996363, 0.00455323, 0, 0.0144569, 0.994021, 0.00461052, 0, 0.0197151, 0.992372, 0.00476359, 0, 0.0257344, 0.991007, 0.00499101, 0, 0.0324882, 0.988767, 0.0051972, 0, 0.0399517, 0.984872, 0.00528407, 0, 0.0481022, 0.982004, 0.00548926, 0, 0.0569191, 0.977714, 0.00564385, 0, 0.0663839, 0.973076, 0.0057693, 0, 0.0764801, 0.967565, 0.0058924, 0, 0.0871928, 0.961384, 0.00599629, 0, 0.0985095, 0.954435, 0.00605998, 0, 0.110419, 0.946303, 0.0061133, 0, 0.122912, 0.937662, 0.00612028, 0, 0.13598, 0.927867, 0.00612209, 0, 0.149617, 0.916475, 0.00604813, 0, 0.163817, 0.90541, 0.00603088, 0, 0.178577, 0.891591, 0.00592218, 0, 0.193894, 0.877573, 0.00578854, 0, 0.209767, 0.862511, 0.00566648, 0, 0.226196, 0.846861, 0.00551481, 0, 0.243182, 0.83068, 0.00533754, 0, 0.260728, 0.815725, 0.00515487, 0, 0.278837, 0.802321, 0.0049655, 0, 0.297515, 0.787826, 0.00475421, 0, 0.316768, 0.773454, 0.00456002, 0, 0.336605, 0.758224, 0.00434727, 0, 0.357034, 0.74265, 0.00414444, 0, 0.378067, 0.726729, 0.00393738, 0, 0.399717, 0.710155, 0.00373575, 0, 0.421998, 0.693312, 0.00353736, 0, 0.444928, 0.67653, 0.00334368, 0, 0.468523, 0.659444, 0.00315981, 0, 0.492806, 0.642051, 0.00297809, 0, 0.517798, 0.625758, 0.00280592, 0, 0.543525, 0.609615, 0.00264254, 0, 0.570012, 0.592919, 0.00248459, 0, 0.597288, 0.576298, 0.00233327, 0, 0.625379, 0.559489, 0.00219519, 0, 0.654307, 0.542891, 0.00205441, 0, 0.684084, 0.526255, 0.00193385, 0, 0.714693, 0.509853, 0.00180745, 0, 0.746044, 0.494131, 0.00169817, 0, 0.777778, 0.478114, 0.0015913, 0, 0.809524, 0.462274, 0.00148981, 0, 0.84127, 0.446412, 0.00139537, 0, 0.873016, 0.431274, 0.00130984, 0, 0.904762, 0.41635, 0.00122403, 0, 0.936508, 0.401476, 0.00114809, 0, 0.968254, 0.386993, 0.00107563, 0, 1, 1, 0.00488216, 0, 0, 1, 0.0048822, 0, 0, 1, 0.00488265, 0, 0, 0.999997, 0.00488463, 0, 0, 0.999988, 0.00488999, 0, 0, 0.999974, 0.00490129, 0, 0, 0.999946, 0.00492191, 0, 0, 0.999897, 0.00495598, 0, 0, 0.999825, 0.00500855, 0, 7.44791e-05, 0.999718, 0.00508559, 0, 0.000712744, 0.999565, 0.005194, 0, 0.00215249, 0.999352, 0.00534147, 0, 0.00444576, 0.999046, 0.00553523, 0, 0.00759218, 0.998492, 0.00577016, 0, 0.0115714, 0.995564, 0.00578487, 0, 0.0163557, 0.993339, 0.00586414, 0, 0.021915, 0.991834, 0.00606002, 0, 0.0282201, 0.990496, 0.00633312, 0, 0.0352433, 0.987826, 0.00651941, 0, 0.042959, 0.98383, 0.00660842, 0, 0.0513439, 0.98109, 0.00685523, 0, 0.0603772, 0.976131, 0.00695778, 0, 0.0700402, 0.971922, 0.00714236, 0, 0.0803163, 0.965901, 0.00721437, 0, 0.0911908, 0.959606, 0.00732017, 0, 0.102651, 0.952504, 0.00735788, 0, 0.114686, 0.944365, 0.00738493, 0, 0.127286, 0.935652, 0.00737969, 0, 0.140443, 0.925813, 0.00733612, 0, 0.154151, 0.914397, 0.00723094, 0, 0.168405, 0.903257, 0.00714002, 0, 0.183201, 0.890015, 0.00700149, 0, 0.198536, 0.876014, 0.00682813, 0, 0.214409, 0.861436, 0.00665567, 0, 0.23082, 0.845752, 0.00644526, 0, 0.24777, 0.829169, 0.00621635, 0, 0.265263, 0.813435, 0.00597789, 0, 0.283301, 0.799701, 0.00575694, 0, 0.301889, 0.785726, 0.00549866, 0, 0.321035, 0.77152, 0.0052503, 0, 0.340746, 0.75683, 0.00499619, 0, 0.361032, 0.741951, 0.0047543, 0, 0.381904, 0.726367, 0.0045084, 0, 0.403374, 0.710537, 0.00426784, 0, 0.425457, 0.693965, 0.00403487, 0, 0.448169, 0.677724, 0.0038075, 0, 0.47153, 0.66117, 0.00359431, 0, 0.495561, 0.644274, 0.00338354, 0, 0.520284, 0.627449, 0.00318163, 0, 0.545725, 0.611645, 0.00299672, 0, 0.571911, 0.595614, 0.00281016, 0, 0.598873, 0.579426, 0.00264252, 0, 0.62664, 0.563016, 0.00247509, 0, 0.655239, 0.546728, 0.00232647, 0, 0.684692, 0.530539, 0.00217803, 0, 0.714999, 0.514164, 0.00204216, 0, 0.746106, 0.498344, 0.00191403, 0, 0.777778, 0.482957, 0.00179203, 0, 0.809524, 0.467336, 0.00167695, 0, 0.84127, 0.451994, 0.00157567, 0, 0.873016, 0.436514, 0.00147113, 0, 0.904762, 0.42178, 0.00138034, 0, 0.936508, 0.407271, 0.00129219, 0, 0.968254, 0.392822, 0.0012098, 0, 1, 1, 0.00637427, 0, 0, 1, 0.00637431, 0, 0, 0.999999, 0.00637485, 0, 0, 0.999996, 0.00637721, 0, 0, 0.999987, 0.00638357, 0, 0, 0.999971, 0.006397, 0, 0, 0.999939, 0.00642142, 0, 0, 0.999888, 0.00646177, 0, 0, 0.999807, 0.00652387, 0, 0.000207916, 0.999689, 0.00661454, 0, 0.00112051, 0.99952, 0.00674155, 0, 0.00287719, 0.999283, 0.00691313, 0, 0.00550145, 0.998936, 0.00713598, 0, 0.00897928, 0.998165, 0.00738501, 0, 0.0132829, 0.994847, 0.00734388, 0, 0.01838, 0.993182, 0.00749991, 0, 0.0242381, 0.991665, 0.0077246, 0, 0.030826, 0.989708, 0.00797579, 0, 0.0381152, 0.986663, 0.00813011, 0, 0.0460794, 0.983288, 0.00830365, 0, 0.0546951, 0.980104, 0.00853496, 0, 0.0639411, 0.974855, 0.00861045, 0, 0.0737988, 0.97045, 0.00879133, 0, 0.0842516, 0.964509, 0.00886377, 0, 0.0952848, 0.957594, 0.00890346, 0, 0.106886, 0.950546, 0.00893289, 0, 0.119044, 0.942225, 0.00890074, 0, 0.131749, 0.933365, 0.00886826, 0, 0.144994, 0.923202, 0.0087316, 0, 0.158772, 0.912605, 0.00863082, 0, 0.173078, 0.901099, 0.00847403, 0, 0.187908, 0.888177, 0.00825838, 0, 0.203261, 0.873955, 0.00801834, 0, 0.219134, 0.860091, 0.00779026, 0, 0.235527, 0.84434, 0.00752478, 0, 0.252443, 0.828517, 0.00724074, 0, 0.269883, 0.81239, 0.00693769, 0, 0.287851, 0.79721, 0.00664817, 0, 0.306352, 0.783489, 0.00634763, 0, 0.325393, 0.769514, 0.00604221, 0, 0.344981, 0.755419, 0.00573568, 0, 0.365126, 0.741083, 0.00544359, 0, 0.385839, 0.726059, 0.00515515, 0, 0.407132, 0.710809, 0.00487139, 0, 0.42902, 0.695052, 0.00459846, 0, 0.45152, 0.678886, 0.00433412, 0, 0.474651, 0.663042, 0.00407981, 0, 0.498433, 0.646634, 0.00384264, 0, 0.52289, 0.630117, 0.00360897, 0, 0.548048, 0.613804, 0.00338863, 0, 0.573936, 0.598338, 0.00318486, 0, 0.600584, 0.582687, 0.00298377, 0, 0.628027, 0.566809, 0.00280082, 0, 0.656295, 0.550817, 0.00262255, 0, 0.685417, 0.534937, 0.00245835, 0, 0.715406, 0.519151, 0.00230574, 0, 0.74624, 0.503118, 0.0021549, 0, 0.777778, 0.487723, 0.00202008, 0, 0.809524, 0.472725, 0.00189355, 0, 0.84127, 0.457599, 0.00177108, 0, 0.873016, 0.442558, 0.00165843, 0, 0.904762, 0.427624, 0.00155494, 0, 0.936508, 0.413171, 0.00145273, 0, 0.968254, 0.399122, 0.00136454, 0, 1, 1, 0.00826496, 0, 0, 1, 0.00826499, 0, 0, 1, 0.00826564, 0, 0, 0.999996, 0.00826842, 0, 0, 0.999987, 0.00827589, 0, 0, 0.999967, 0.00829167, 0, 0, 0.999933, 0.00832037, 0, 0, 0.999876, 0.00836768, 0, 1.09338e-05, 0.999786, 0.00844031, 0, 0.000427145, 0.999655, 0.00854603, 0, 0.0016384, 0.999468, 0.00869337, 0, 0.00372392, 0.999203, 0.008891, 0, 0.00668513, 0.998803, 0.00914387, 0, 0.0104968, 0.99748, 0.00935838, 0, 0.015125, 0.994446, 0.00933309, 0, 0.0205338, 0.99292, 0.00953084, 0, 0.0266884, 0.991414, 0.0097893, 0, 0.0335565, 0.989049, 0.0100228, 0, 0.0411086, 0.98582, 0.0101664, 0, 0.0493181, 0.982441, 0.0103582, 0, 0.0581613, 0.978595, 0.0105292, 0, 0.0676169, 0.973495, 0.0106274, 0, 0.0776661, 0.968405, 0.0107261, 0, 0.0882926, 0.962717, 0.0108234, 0, 0.0994817, 0.955478, 0.0108102, 0, 0.111221, 0.948275, 0.0107914, 0, 0.123499, 0.940006, 0.0107161, 0, 0.136308, 0.930831, 0.0106309, 0, 0.149639, 0.920648, 0.0104083, 0, 0.163485, 0.910205, 0.0102312, 0, 0.177843, 0.898445, 0.0100051, 0, 0.192707, 0.885986, 0.00971928, 0, 0.208077, 0.872204, 0.00940747, 0, 0.22395, 0.858436, 0.0091085, 0, 0.240326, 0.843454, 0.00876595, 0, 0.257208, 0.827437, 0.00839794, 0, 0.274596, 0.811488, 0.00803692, 0, 0.292496, 0.796039, 0.00767352, 0, 0.310911, 0.781083, 0.0073097, 0, 0.329849, 0.767642, 0.00694032, 0, 0.349316, 0.753901, 0.00657476, 0, 0.369323, 0.740131, 0.00622699, 0, 0.38988, 0.725845, 0.0058838, 0, 0.410999, 0.710991, 0.00555586, 0, 0.432696, 0.696002, 0.00523089, 0, 0.454987, 0.680461, 0.00492494, 0, 0.47789, 0.664875, 0.00463464, 0, 0.501426, 0.649273, 0.00435422, 0, 0.52562, 0.63302, 0.0040875, 0, 0.550498, 0.61705, 0.00384075, 0, 0.576089, 0.601154, 0.00359557, 0, 0.602427, 0.586008, 0.00337636, 0, 0.629544, 0.570699, 0.00316019, 0, 0.657479, 0.555166, 0.00296033, 0, 0.686264, 0.539645, 0.00277552, 0, 0.715924, 0.524159, 0.00259499, 0, 0.746459, 0.508682, 0.00243257, 0, 0.777789, 0.493163, 0.00227851, 0, 0.809524, 0.478004, 0.00213083, 0, 0.84127, 0.46347, 0.00199502, 0, 0.873016, 0.448778, 0.00186967, 0, 0.904762, 0.434105, 0.00174732, 0, 0.936508, 0.419576, 0.00163861, 0, 0.968254, 0.405541, 0.00153341, 0, 1, 1, 0.0106462, 0, 0, 1, 0.0106462, 0, 0, 0.999999, 0.010647, 0, 0, 0.999995, 0.0106502, 0, 0, 0.999985, 0.0106589, 0, 0, 0.999964, 0.0106773, 0, 0, 0.999925, 0.0107106, 0, 0, 0.999861, 0.0107655, 0, 7.12986e-05, 0.999763, 0.0108497, 0, 0.000743959, 0.999616, 0.0109716, 0, 0.00227361, 0.999408, 0.0111408, 0, 0.0046983, 0.999112, 0.0113659, 0, 0.00800158, 0.998637, 0.0116475, 0, 0.0121493, 0.996223, 0.0117231, 0, 0.0171023, 0.994006, 0.0118064, 0, 0.0228218, 0.992444, 0.0120254, 0, 0.0292711, 0.991028, 0.0123314, 0, 0.036417, 0.98803, 0.0124954, 0, 0.0442295, 0.984816, 0.0126538, 0, 0.0526815, 0.981399, 0.0128537, 0, 0.0617492, 0.977085, 0.0129694, 0, 0.0714114, 0.972154, 0.013091, 0, 0.0816495, 0.966617, 0.0131166, 0, 0.0924472, 0.960628, 0.0131583, 0, 0.10379, 0.953295, 0.0131094, 0, 0.115665, 0.94575, 0.0129966, 0, 0.128062, 0.937654, 0.0128796, 0, 0.140972, 0.927716, 0.0126477, 0, 0.154387, 0.917932, 0.0123889, 0, 0.168301, 0.907719, 0.012131, 0, 0.182709, 0.89584, 0.0118013, 0, 0.197608, 0.883526, 0.0114145, 0, 0.212994, 0.870301, 0.0110075, 0, 0.228867, 0.856272, 0.0106019, 0, 0.245227, 0.842251, 0.0101938, 0, 0.262074, 0.826466, 0.00973254, 0, 0.279412, 0.810859, 0.0092846, 0, 0.297244, 0.795051, 0.00883304, 0, 0.315575, 0.780053, 0.00840272, 0, 0.334412, 0.76575, 0.00796438, 0, 0.35376, 0.752298, 0.00752526, 0, 0.373631, 0.739153, 0.00711486, 0, 0.394034, 0.725514, 0.00670361, 0, 0.414983, 0.711473, 0.00632656, 0, 0.436491, 0.696936, 0.00595206, 0, 0.458575, 0.682126, 0.00559191, 0, 0.481253, 0.667027, 0.00525362, 0, 0.504547, 0.651875, 0.00493805, 0, 0.528481, 0.636463, 0.00462848, 0, 0.553081, 0.620641, 0.00433936, 0, 0.578377, 0.604931, 0.00407, 0, 0.604404, 0.589549, 0.00380864, 0, 0.631197, 0.574712, 0.00357049, 0, 0.658795, 0.559775, 0.00334466, 0, 0.687238, 0.544514, 0.00312505, 0, 0.716559, 0.529555, 0.00293199, 0, 0.746776, 0.514402, 0.00274204, 0, 0.777849, 0.499302, 0.00256647, 0, 0.809524, 0.484114, 0.00239901, 0, 0.84127, 0.469308, 0.00225148, 0, 0.873016, 0.455133, 0.00210178, 0, 0.904762, 0.440939, 0.0019727, 0, 0.936508, 0.426627, 0.00184382, 0, 0.968254, 0.412509, 0.00172548, 0, 1, 1, 0.013628, 0, 0, 1, 0.0136281, 0, 0, 0.999999, 0.0136289, 0, 0, 0.999995, 0.0136327, 0, 0, 0.999983, 0.0136427, 0, 0, 0.99996, 0.0136638, 0, 0, 0.999917, 0.0137022, 0, 0, 0.999846, 0.0137652, 0, 0.000204597, 0.999736, 0.0138615, 0, 0.00116837, 0.999573, 0.0140007, 0, 0.00303325, 0.99934, 0.0141927, 0, 0.00580613, 0.999004, 0.0144457, 0, 0.00945626, 0.998407, 0.0147489, 0, 0.0139421, 0.995464, 0.014731, 0, 0.0192202, 0.993328, 0.0148283, 0, 0.0252495, 0.991799, 0.0150797, 0, 0.0319921, 0.990397, 0.0154316, 0, 0.0394138, 0.986835, 0.0155005, 0, 0.0474843, 0.983938, 0.0157308, 0, 0.0561763, 0.980154, 0.0158753, 0, 0.0654661, 0.975659, 0.0159581, 0, 0.0753326, 0.970171, 0.0159832, 0, 0.0857571, 0.964803, 0.0160084, 0, 0.0967236, 0.958366, 0.0159484, 0, 0.108218, 0.950613, 0.0158001, 0, 0.120227, 0.942874, 0.0155845, 0, 0.132741, 0.935005, 0.0154292, 0, 0.145751, 0.924991, 0.0150742, 0, 0.159249, 0.914814, 0.0146757, 0, 0.17323, 0.904743, 0.0143097, 0, 0.187687, 0.893216, 0.0138695, 0, 0.202619, 0.880769, 0.0133706, 0, 0.218021, 0.868136, 0.0128606, 0, 0.233894, 0.85469, 0.0123403, 0, 0.250238, 0.840593, 0.0118091, 0, 0.267052, 0.825808, 0.011253, 0, 0.284341, 0.81009, 0.0107099, 0, 0.302106, 0.79504, 0.0101636, 0, 0.320354, 0.779757, 0.00964041, 0, 0.33909, 0.764697, 0.00911896, 0, 0.358322, 0.750913, 0.00859533, 0, 0.378059, 0.738175, 0.00811592, 0, 0.398311, 0.725242, 0.00764504, 0, 0.41909, 0.711864, 0.00718885, 0, 0.440412, 0.698009, 0.00675843, 0, 0.462292, 0.683841, 0.00634984, 0, 0.484748, 0.669391, 0.00595502, 0, 0.507802, 0.654731, 0.00558671, 0, 0.531477, 0.639805, 0.00523578, 0, 0.555802, 0.624789, 0.00490834, 0, 0.580805, 0.609325, 0.00459448, 0, 0.606522, 0.593975, 0.00430342, 0, 0.63299, 0.578983, 0.00403019, 0, 0.66025, 0.564442, 0.0037707, 0, 0.688346, 0.549835, 0.0035316, 0, 0.717319, 0.535039, 0.00330255, 0, 0.7472, 0.520403, 0.00308932, 0, 0.777982, 0.505687, 0.00289335, 0, 0.809524, 0.490939, 0.00270818, 0, 0.84127, 0.476233, 0.0025343, 0, 0.873016, 0.461624, 0.00237097, 0, 0.904762, 0.447833, 0.00222065, 0, 0.936508, 0.433992, 0.00207561, 0, 0.968254, 0.420147, 0.00194955, 0, 1, 1, 0.0173415, 0, 0, 1, 0.0173416, 0, 0, 0.999999, 0.0173426, 0, 0, 0.999995, 0.0173468, 0, 0, 0.999983, 0.0173582, 0, 0, 0.999954, 0.0173822, 0, 0, 0.999908, 0.0174258, 0, 6.69501e-06, 0.999828, 0.0174973, 0, 0.000427399, 0.999705, 0.0176063, 0, 0.00171019, 0.999524, 0.0177631, 0, 0.0039248, 0.999263, 0.0179781, 0, 0.00705382, 0.998878, 0.018258, 0, 0.0110552, 0.998012, 0.0185551, 0, 0.0158812, 0.994614, 0.0184264, 0, 0.0214852, 0.993132, 0.0186385, 0, 0.0278239, 0.991563, 0.0189067, 0, 0.0348585, 0.989298, 0.0191577, 0, 0.0425544, 0.986036, 0.0192522, 0, 0.050881, 0.982558, 0.0194063, 0, 0.059811, 0.978531, 0.019486, 0, 0.0693209, 0.974198, 0.0195847, 0, 0.0793895, 0.968148, 0.0194749, 0, 0.0899984, 0.962565, 0.0194277, 0, 0.101132, 0.956041, 0.0192991, 0, 0.112775, 0.947749, 0.0189893, 0, 0.124917, 0.94018, 0.018704, 0, 0.137547, 0.93165, 0.0183458, 0, 0.150655, 0.921798, 0.0178775, 0, 0.164236, 0.911573, 0.0173618, 0, 0.178281, 0.901569, 0.0168482, 0, 0.192788, 0.890341, 0.016265, 0, 0.207752, 0.877835, 0.0156199, 0, 0.223171, 0.865472, 0.0149516, 0, 0.239044, 0.852905, 0.0143274, 0, 0.255371, 0.838906, 0.0136643, 0, 0.272153, 0.824888, 0.0129903, 0, 0.289393, 0.809977, 0.0123218, 0, 0.307093, 0.794697, 0.0116572, 0, 0.325259, 0.780028, 0.0110307, 0, 0.343896, 0.765124, 0.0104236, 0, 0.363012, 0.750411, 0.0098219, 0, 0.382617, 0.737264, 0.00924397, 0, 0.402719, 0.724799, 0.00868719, 0, 0.423332, 0.712253, 0.00816476, 0, 0.444469, 0.699267, 0.00767262, 0, 0.466146, 0.685618, 0.00719746, 0, 0.488383, 0.671736, 0.00673916, 0, 0.511199, 0.657777, 0.00631937, 0, 0.534618, 0.643497, 0.00592411, 0, 0.558668, 0.62889, 0.00553928, 0, 0.58338, 0.614299, 0.0051934, 0, 0.608787, 0.599197, 0.00485985, 0, 0.634929, 0.584175, 0.00454357, 0, 0.661849, 0.569541, 0.00425787, 0, 0.689594, 0.555193, 0.00397905, 0, 0.718211, 0.540947, 0.00372364, 0, 0.747742, 0.526593, 0.00348599, 0, 0.778205, 0.512335, 0.00326103, 0, 0.80953, 0.498017, 0.00305137, 0, 0.84127, 0.483609, 0.00285485, 0, 0.873016, 0.469368, 0.00267472, 0, 0.904762, 0.455037, 0.00249945, 0, 0.936508, 0.441493, 0.00234792, 0, 0.968254, 0.428147, 0.00219936, 0, 1, 1, 0.0219422, 0, 0, 1, 0.0219423, 0, 0, 0.999998, 0.0219434, 0, 0, 0.999993, 0.0219481, 0, 0, 0.999981, 0.021961, 0, 0, 0.999949, 0.0219879, 0, 0, 0.999896, 0.0220367, 0, 5.93194e-05, 0.999808, 0.0221167, 0, 0.00075364, 0.99967, 0.0222383, 0, 0.00237884, 0.999466, 0.0224125, 0, 0.00495612, 0.999174, 0.0226495, 0, 0.00844887, 0.998725, 0.0229525, 0, 0.0128058, 0.996979, 0.0231123, 0, 0.0179742, 0.994317, 0.0230742, 0, 0.0239047, 0.992781, 0.0232895, 0, 0.0305526, 0.991191, 0.0235734, 0, 0.0378786, 0.987787, 0.0236152, 0, 0.0458475, 0.985092, 0.0237994, 0, 0.0544287, 0.981121, 0.0238553, 0, 0.0635952, 0.976924, 0.0238706, 0, 0.0733233, 0.97218, 0.0238704, 0, 0.0835922, 0.965956, 0.0236598, 0, 0.0943839, 0.959998, 0.0234735, 0, 0.105682, 0.953245, 0.0232277, 0, 0.117474, 0.944445, 0.0226973, 0, 0.129747, 0.937087, 0.0223527, 0, 0.142491, 0.928341, 0.0218144, 0, 0.155697, 0.9184, 0.0211516, 0, 0.169358, 0.907959, 0.0204553, 0, 0.183469, 0.89808, 0.0197673, 0, 0.198024, 0.887047, 0.0189915, 0, 0.21302, 0.875221, 0.0182082, 0, 0.228455, 0.86269, 0.0173584, 0, 0.244329, 0.850735, 0.0165718, 0, 0.260639, 0.837545, 0.0157524, 0, 0.277389, 0.823639, 0.0149482, 0, 0.29458, 0.809699, 0.0141431, 0, 0.312216, 0.794797, 0.0133527, 0, 0.3303, 0.780578, 0.0126193, 0, 0.34884, 0.766019, 0.0118914, 0, 0.367842, 0.751447, 0.0111839, 0, 0.387315, 0.737275, 0.010514, 0, 0.40727, 0.724545, 0.00987277, 0, 0.427717, 0.712644, 0.00926569, 0, 0.448671, 0.700432, 0.00869029, 0, 0.470149, 0.687664, 0.00814691, 0, 0.492167, 0.674288, 0.00763012, 0, 0.514746, 0.660966, 0.00714437, 0, 0.537911, 0.647264, 0.00668457, 0, 0.561688, 0.633431, 0.00626581, 0, 0.586108, 0.619133, 0.00585593, 0, 0.611206, 0.604935, 0.00548188, 0, 0.637022, 0.590236, 0.00513288, 0, 0.663599, 0.575473, 0.0047906, 0, 0.690989, 0.561228, 0.00448895, 0, 0.719242, 0.547054, 0.00420233, 0, 0.748411, 0.533175, 0.00392869, 0, 0.778531, 0.519163, 0.00367445, 0, 0.809583, 0.505328, 0.00344097, 0, 0.84127, 0.491446, 0.00322003, 0, 0.873016, 0.477356, 0.00301283, 0, 0.904762, 0.46356, 0.00282592, 0, 0.936508, 0.449623, 0.00264956, 0, 0.968254, 0.436068, 0.00246956, 0, 1, 1, 0.0276135, 0, 0, 1, 0.0276136, 0, 0, 0.999998, 0.0276148, 0, 0, 0.999993, 0.0276201, 0, 0, 0.999976, 0.0276342, 0, 0, 0.999945, 0.027664, 0, 0, 0.999884, 0.0277179, 0, 0.00018679, 0.999784, 0.027806, 0, 0.00119607, 0.99963, 0.0279394, 0, 0.00318407, 0.999401, 0.0281295, 0, 0.00613601, 0.999066, 0.0283858, 0, 0.00999963, 0.998524, 0.0287027, 0, 0.0147164, 0.995702, 0.0286256, 0, 0.0202295, 0.993593, 0.0286733, 0, 0.0264876, 0.992067, 0.0288989, 0, 0.0334452, 0.990548, 0.0292135, 0, 0.0410621, 0.986775, 0.0291296, 0, 0.0493032, 0.984054, 0.0293099, 0, 0.0581381, 0.979481, 0.0291881, 0, 0.0675397, 0.975297, 0.0291598, 0, 0.0774848, 0.96981, 0.028954, 0, 0.0879528, 0.963524, 0.028628, 0, 0.0989258, 0.957398, 0.0283135, 0, 0.110388, 0.950088, 0.0278469, 0, 0.122327, 0.941538, 0.0271798, 0, 0.134729, 0.933332, 0.0265388, 0, 0.147587, 0.924392, 0.0257776, 0, 0.160889, 0.914581, 0.024916, 0, 0.174631, 0.904347, 0.0240242, 0, 0.188806, 0.894324, 0.0231229, 0, 0.203409, 0.883724, 0.022153, 0, 0.218437, 0.872207, 0.0211355, 0, 0.233888, 0.859927, 0.0201048, 0, 0.249761, 0.848373, 0.0191263, 0, 0.266056, 0.836023, 0.0181306, 0, 0.282774, 0.82289, 0.0171718, 0, 0.299917, 0.809324, 0.0162196, 0, 0.317488, 0.795361, 0.0152622, 0, 0.335493, 0.781253, 0.01439, 0, 0.353936, 0.767338, 0.013533, 0, 0.372825, 0.753156, 0.0127244, 0, 0.392168, 0.739122, 0.0119454, 0, 0.411976, 0.725358, 0.0112054, 0, 0.432259, 0.712949, 0.010487, 0, 0.453032, 0.701621, 0.00984032, 0, 0.47431, 0.689703, 0.00921495, 0, 0.496111, 0.677216, 0.00862492, 0, 0.518456, 0.664217, 0.00806882, 0, 0.541367, 0.65137, 0.00755922, 0, 0.564872, 0.638, 0.00705705, 0, 0.589001, 0.62453, 0.00661266, 0, 0.613789, 0.610601, 0.00618432, 0, 0.639277, 0.59676, 0.00578033, 0, 0.66551, 0.582433, 0.00540927, 0, 0.692539, 0.568026, 0.00506104, 0, 0.720422, 0.55414, 0.0047353, 0, 0.749216, 0.540178, 0.00442889, 0, 0.778974, 0.526513, 0.00414363, 0, 0.809711, 0.512954, 0.00388237, 0, 0.84127, 0.499403, 0.00362875, 0, 0.873016, 0.486026, 0.00340827, 0, 0.904762, 0.472345, 0.00318598, 0, 0.936508, 0.458828, 0.00297635, 0, 0.968254, 0.445379, 0.00279447, 0, 1, 1, 0.0345716, 0, 0, 1, 0.0345717, 0, 0, 0.999999, 0.034573, 0, 0, 0.999991, 0.0345787, 0, 0, 0.999974, 0.0345941, 0, 0, 0.999937, 0.0346263, 0, 1.88589e-06, 0.999869, 0.0346847, 0, 0.000409238, 0.999757, 0.0347798, 0, 0.0017674, 0.999582, 0.0349233, 0, 0.00413658, 0.999322, 0.0351265, 0, 0.00747408, 0.998939, 0.0353967, 0, 0.0117157, 0.998219, 0.0357018, 0, 0.0167966, 0.994974, 0.0354726, 0, 0.0226572, 0.993201, 0.0355621, 0, 0.0292445, 0.991573, 0.0357641, 0, 0.0365123, 0.989301, 0.0359252, 0, 0.0444203, 0.985712, 0.0358017, 0, 0.0529334, 0.982411, 0.0358353, 0, 0.0620214, 0.977827, 0.035617, 0, 0.0716574, 0.973278, 0.0354398, 0, 0.0818186, 0.967397, 0.0350483, 0, 0.0924846, 0.960696, 0.0344795, 0, 0.103638, 0.954349, 0.0339861, 0, 0.115263, 0.946066, 0.0331323, 0, 0.127348, 0.938012, 0.032359, 0, 0.13988, 0.929413, 0.0314413, 0, 0.152849, 0.920355, 0.0304103, 0, 0.166248, 0.910586, 0.0292785, 0, 0.18007, 0.900609, 0.0281391, 0, 0.194308, 0.890093, 0.0269103, 0, 0.208958, 0.880013, 0.0257269, 0, 0.224018, 0.869001, 0.0244671, 0, 0.239485, 0.85751, 0.0232252, 0, 0.255359, 0.84582, 0.0220117, 0, 0.271638, 0.834383, 0.0208274, 0, 0.288324, 0.822158, 0.0196628, 0, 0.305419, 0.809056, 0.0185306, 0, 0.322927, 0.795832, 0.0174174, 0, 0.340851, 0.782547, 0.0163758, 0, 0.359199, 0.7689, 0.015391, 0, 0.377975, 0.755526, 0.0144488, 0, 0.397189, 0.741681, 0.0135372, 0, 0.416851, 0.728178, 0.0126957, 0, 0.436971, 0.714642, 0.0118812, 0, 0.457564, 0.702756, 0.0111165, 0, 0.478644, 0.69175, 0.0104145, 0, 0.500229, 0.680159, 0.00974439, 0, 0.522339, 0.668073, 0.00911926, 0, 0.544997, 0.655405, 0.00851393, 0, 0.56823, 0.642921, 0.00797637, 0, 0.592068, 0.629993, 0.00745119, 0, 0.616546, 0.616828, 0.00696972, 0, 0.641705, 0.603305, 0.00652425, 0, 0.66759, 0.589833, 0.00610188, 0, 0.694255, 0.575945, 0.00570834, 0, 0.72176, 0.561745, 0.00533384, 0, 0.750168, 0.548277, 0.00500001, 0, 0.779545, 0.534467, 0.00467582, 0, 0.809933, 0.521032, 0.00438092, 0, 0.841272, 0.507877, 0.00410348, 0, 0.873016, 0.494654, 0.00383618, 0, 0.904762, 0.481592, 0.00358699, 0, 0.936508, 0.468509, 0.00337281, 0, 0.968254, 0.455293, 0.00316196, 0, 1, 1, 0.0430698, 0, 0, 1, 0.0430699, 0, 0, 0.999998, 0.0430713, 0, 0, 0.999991, 0.0430773, 0, 0, 0.99997, 0.0430936, 0, 0, 0.999928, 0.0431277, 0, 4.06396e-05, 0.999852, 0.0431893, 0, 0.000744376, 0.999724, 0.0432895, 0, 0.0024806, 0.999527, 0.0434397, 0, 0.00524779, 0.99923, 0.0436507, 0, 0.00898164, 0.998783, 0.0439255, 0, 0.0136083, 0.997507, 0.0441104, 0, 0.0190582, 0.994418, 0.0438225, 0, 0.0252694, 0.992864, 0.0439396, 0, 0.0321879, 0.991127, 0.0440962, 0, 0.039767, 0.987331, 0.0438408, 0, 0.0479667, 0.984819, 0.0438991, 0, 0.056752, 0.980384, 0.0435906, 0, 0.0660929, 0.975846, 0.0432543, 0, 0.075963, 0.970748, 0.0428293, 0, 0.0863398, 0.964303, 0.042153, 0, 0.0972035, 0.95772, 0.0414111, 0, 0.108537, 0.950747, 0.0405893, 0, 0.120325, 0.942533, 0.0394887, 0, 0.132554, 0.934045, 0.0383544, 0, 0.145215, 0.924942, 0.037057, 0, 0.158296, 0.915811, 0.0356993, 0, 0.17179, 0.90612, 0.0342401, 0, 0.185691, 0.896434, 0.0328078, 0, 0.199993, 0.886021, 0.031288, 0, 0.214691, 0.876081, 0.0297776, 0, 0.229782, 0.865608, 0.0282334, 0, 0.245265, 0.854924, 0.026749, 0, 0.261138, 0.843607, 0.02526, 0, 0.277401, 0.832456, 0.0238214, 0, 0.294056, 0.821342, 0.0224682, 0, 0.311104, 0.809303, 0.0211297, 0, 0.328548, 0.796468, 0.0198387, 0, 0.346394, 0.784046, 0.0186227, 0, 0.364645, 0.771262, 0.0174561, 0, 0.38331, 0.758118, 0.0163806, 0, 0.402396, 0.745075, 0.0153287, 0, 0.421912, 0.731926, 0.0143647, 0, 0.44187, 0.71863, 0.0134363, 0, 0.462283, 0.705414, 0.0125603, 0, 0.483165, 0.693792, 0.0117508, 0, 0.504535, 0.683108, 0.0110016, 0, 0.52641, 0.67183, 0.0102757, 0, 0.548816, 0.66015, 0.00962044, 0, 0.571776, 0.647907, 0.00898031, 0, 0.595323, 0.635734, 0.00840811, 0, 0.619489, 0.623208, 0.00786211, 0, 0.644317, 0.610438, 0.00734953, 0, 0.669852, 0.597345, 0.00687688, 0, 0.696148, 0.584138, 0.00643469, 0, 0.723267, 0.5707, 0.00602236, 0, 0.75128, 0.556966, 0.0056324, 0, 0.780258, 0.543607, 0.00528277, 0, 0.810268, 0.530213, 0.00493999, 0, 0.841311, 0.516912, 0.00462265, 0, 0.873016, 0.503916, 0.0043307, 0, 0.904762, 0.491146, 0.00406858, 0, 0.936508, 0.478439, 0.00381436, 0, 0.968254, 0.465834, 0.00358003, 0, 1, 1, 0.0534039, 0, 0, 1, 0.053404, 0, 0, 0.999998, 0.0534055, 0, 0, 0.999989, 0.0534116, 0, 0, 0.999968, 0.0534283, 0, 0, 0.999918, 0.0534633, 0, 0.000155895, 0.99983, 0.0535262, 0, 0.00120914, 0.999685, 0.0536281, 0, 0.00334944, 0.999461, 0.0537799, 0, 0.00653077, 0.999119, 0.0539902, 0, 0.0106718, 0.998582, 0.0542524, 0, 0.0156907, 0.995919, 0.0540318, 0, 0.0215147, 0.993735, 0.0538914, 0, 0.0280801, 0.992126, 0.0539557, 0, 0.0353323, 0.990266, 0.0540401, 0, 0.0432247, 0.986317, 0.0536064, 0, 0.0517172, 0.983213, 0.0534425, 0, 0.0607754, 0.978303, 0.0528622, 0, 0.0703698, 0.973665, 0.0523363, 0, 0.0804742, 0.968091, 0.0516165, 0, 0.0910667, 0.961026, 0.0505434, 0, 0.102128, 0.954333, 0.049523, 0, 0.113641, 0.946372, 0.0481698, 0, 0.125591, 0.938254, 0.0467674, 0, 0.137965, 0.929516, 0.0452341, 0, 0.150754, 0.920106, 0.0435083, 0, 0.163947, 0.910899, 0.0417399, 0, 0.177537, 0.901532, 0.0399389, 0, 0.191516, 0.891919, 0.0380901, 0, 0.205881, 0.882006, 0.0362341, 0, 0.220626, 0.871965, 0.0343444, 0, 0.235749, 0.862145, 0.0324832, 0, 0.251248, 0.852058, 0.0306681, 0, 0.267121, 0.84161, 0.0289097, 0, 0.283368, 0.830806, 0.0272079, 0, 0.299992, 0.820476, 0.0256089, 0, 0.316992, 0.809514, 0.0240394, 0, 0.334374, 0.797865, 0.0225379, 0, 0.35214, 0.785621, 0.0211235, 0, 0.370296, 0.773765, 0.0197908, 0, 0.388849, 0.761629, 0.0185235, 0, 0.407807, 0.748891, 0.0173358, 0, 0.427178, 0.736437, 0.0162305, 0, 0.446974, 0.723707, 0.0151778, 0, 0.467207, 0.710606, 0.0141791, 0, 0.487892, 0.698019, 0.0132592, 0, 0.509046, 0.686203, 0.0123887, 0, 0.530687, 0.675692, 0.0115976, 0, 0.552839, 0.664826, 0.0108325, 0, 0.575527, 0.65349, 0.0101348, 0, 0.59878, 0.641774, 0.00947756, 0, 0.622634, 0.629794, 0.00886058, 0, 0.647128, 0.617647, 0.00828526, 0, 0.672308, 0.60534, 0.00775312, 0, 0.698231, 0.592718, 0.00726033, 0, 0.724958, 0.579746, 0.00679731, 0, 0.752563, 0.566763, 0.00636111, 0, 0.781127, 0.553515, 0.00595228, 0, 0.810733, 0.540118, 0.00556876, 0, 0.841426, 0.527325, 0.00523051, 0, 0.873016, 0.514265, 0.00490712, 0, 0.904762, 0.501406, 0.00460297, 0, 0.936508, 0.488922, 0.00431247, 0, 0.968254, 0.476541, 0.0040472, 0, 1, 1, 0.0659184, 0, 0, 1, 0.0659185, 0, 0, 0.999998, 0.06592, 0, 0, 0.999988, 0.0659259, 0, 0, 0.999963, 0.0659423, 0, 0, 0.999907, 0.0659764, 0, 0.000374198, 0.999806, 0.0660376, 0, 0.00182071, 0.999639, 0.0661361, 0, 0.0043894, 0.999378, 0.0662814, 0, 0.00800055, 0.998985, 0.0664779, 0, 0.0125594, 0.998285, 0.0666914, 0, 0.0179786, 0.995071, 0.0661989, 0, 0.0241822, 0.993172, 0.0660454, 0, 0.031106, 0.991438, 0.0660105, 0, 0.0386952, 0.988428, 0.0656875, 0, 0.0469032, 0.985218, 0.0652913, 0, 0.0556905, 0.981128, 0.0647107, 0, 0.065023, 0.976015, 0.0638491, 0, 0.0748717, 0.97097, 0.062993, 0, 0.0852112, 0.964582, 0.0617927, 0, 0.0960199, 0.957383, 0.0603626, 0, 0.107279, 0.949969, 0.0588128, 0, 0.118971, 0.941843, 0.0570274, 0, 0.131084, 0.933624, 0.0551885, 0, 0.143604, 0.924543, 0.053122, 0, 0.156521, 0.914919, 0.0508897, 0, 0.169825, 0.905773, 0.0486418, 0, 0.18351, 0.896434, 0.0463364, 0, 0.197569, 0.887195, 0.0440623, 0, 0.211997, 0.877706, 0.0417799, 0, 0.226789, 0.867719, 0.03945, 0, 0.241944, 0.858587, 0.037243, 0, 0.257458, 0.849317, 0.0350956, 0, 0.273331, 0.839585, 0.0329852, 0, 0.289563, 0.829856, 0.0310028, 0, 0.306154, 0.819589, 0.0290953, 0, 0.323108, 0.809714, 0.0272738, 0, 0.340426, 0.79934, 0.0255631, 0, 0.358113, 0.788224, 0.0239175, 0, 0.376175, 0.776619, 0.0223831, 0, 0.394616, 0.76521, 0.0209298, 0, 0.413445, 0.753716, 0.0195786, 0, 0.432671, 0.741564, 0.0183001, 0, 0.452305, 0.729413, 0.0171259, 0, 0.472358, 0.717146, 0.0159933, 0, 0.492845, 0.70436, 0.0149495, 0, 0.513783, 0.69219, 0.0139681, 0, 0.535189, 0.680289, 0.0130577, 0, 0.557087, 0.669611, 0.0122198, 0, 0.5795, 0.659113, 0.0114174, 0, 0.602459, 0.648148, 0.0106729, 0, 0.625997, 0.636905, 0.00998997, 0, 0.650154, 0.625154, 0.00934313, 0, 0.674976, 0.613481, 0.00874839, 0, 0.700518, 0.60154, 0.00818265, 0, 0.726845, 0.58943, 0.00766889, 0, 0.754032, 0.576828, 0.00717153, 0, 0.782167, 0.564194, 0.00672696, 0, 0.811344, 0.551501, 0.00630863, 0, 0.841644, 0.538635, 0.00592177, 0, 0.873016, 0.525724, 0.00554888, 0, 0.904762, 0.513209, 0.00520225, 0, 0.936508, 0.500457, 0.00488231, 0, 0.968254, 0.48799, 0.00457153, 0, 1, 1, 0.0810131, 0, 0, 1, 0.0810133, 0, 0, 0.999997, 0.0810145, 0, 0, 0.999985, 0.08102, 0, 0, 0.999956, 0.0810347, 0, 1.95026e-05, 0.999893, 0.0810656, 0, 0.000719316, 0.999777, 0.0811205, 0, 0.00259774, 0.999583, 0.081208, 0, 0.00561807, 0.999281, 0.0813343, 0, 0.00967472, 0.998813, 0.0814969, 0, 0.0146627, 0.997597, 0.0815217, 0, 0.0204902, 0.994379, 0.0808502, 0, 0.0270802, 0.992744, 0.0806792, 0, 0.0343674, 0.990745, 0.0804589, 0, 0.0422974, 0.986646, 0.0796107, 0, 0.0508242, 0.983611, 0.0790913, 0, 0.0599087, 0.978869, 0.0780746, 0, 0.0695175, 0.973475, 0.0768218, 0, 0.0796223, 0.967845, 0.0754926, 0, 0.0901983, 0.960778, 0.0737063, 0, 0.101224, 0.953333, 0.0718052, 0, 0.112682, 0.945274, 0.0695946, 0, 0.124555, 0.936955, 0.0672492, 0, 0.136831, 0.928319, 0.0647732, 0, 0.149496, 0.919075, 0.0620947, 0, 0.162542, 0.909114, 0.0591816, 0, 0.175958, 0.900137, 0.0563917, 0, 0.189739, 0.891069, 0.0535392, 0, 0.203877, 0.882262, 0.0507642, 0, 0.218368, 0.873232, 0.0479793, 0, 0.233208, 0.864042, 0.045226, 0, 0.248393, 0.855002, 0.0425413, 0, 0.263923, 0.846569, 0.0400126, 0, 0.279796, 0.837714, 0.0375269, 0, 0.296012, 0.828918, 0.0352027, 0, 0.312573, 0.819783, 0.0330011, 0, 0.329479, 0.810129, 0.0308908, 0, 0.346734, 0.800866, 0.0289112, 0, 0.364342, 0.79093, 0.0270255, 0, 0.382307, 0.780593, 0.0252758, 0, 0.400637, 0.769511, 0.0236178, 0, 0.419337, 0.758558, 0.0220652, 0, 0.438418, 0.747632, 0.0206289, 0, 0.457889, 0.736146, 0.0192873, 0, 0.477761, 0.724093, 0.0180333, 0, 0.49805, 0.71234, 0.0168264, 0, 0.51877, 0.700201, 0.015746, 0, 0.53994, 0.687949, 0.0147027, 0, 0.561581, 0.676163, 0.0137512, 0, 0.583718, 0.665001, 0.0128655, 0, 0.60638, 0.65472, 0.0120366, 0, 0.629599, 0.644213, 0.0112604, 0, 0.653415, 0.633382, 0.0105413, 0, 0.677874, 0.62212, 0.00986498, 0, 0.70303, 0.610631, 0.00923308, 0, 0.728948, 0.599078, 0.00864206, 0, 0.755706, 0.587519, 0.00811784, 0, 0.783396, 0.575505, 0.00761237, 0, 0.812121, 0.563148, 0.00713949, 0, 0.841989, 0.550828, 0.00668379, 0, 0.873035, 0.538458, 0.00627715, 0, 0.904762, 0.525905, 0.00588336, 0, 0.936508, 0.513517, 0.00552687, 0, 0.968254, 0.501395, 0.00519681, 0, 1, 1, 0.0991506, 0, 0, 1, 0.0991504, 0, 0, 0.999996, 0.0991515, 0, 0, 0.999984, 0.0991558, 0, 0, 0.999947, 0.0991672, 0, 0.000114389, 0.999874, 0.0991912, 0, 0.00121503, 0.999739, 0.0992331, 0, 0.00356108, 0.999514, 0.0992983, 0, 0.00705578, 0.999159, 0.0993877, 0, 0.011574, 0.998586, 0.0994837, 0, 0.017003, 0.995731, 0.0988425, 0, 0.0232484, 0.993384, 0.098276, 0, 0.0302318, 0.991615, 0.0979269, 0, 0.0378884, 0.989029, 0.0973432, 0, 0.0461641, 0.985373, 0.0963539, 0, 0.0550136, 0.981278, 0.0952306, 0, 0.0643988, 0.975777, 0.0936233, 0, 0.0742868, 0.970526, 0.0920219, 0, 0.0846501, 0.963755, 0.0898912, 0, 0.0954644, 0.956676, 0.0876064, 0, 0.106709, 0.948099, 0.0847751, 0, 0.118367, 0.939718, 0.0818638, 0, 0.130423, 0.931305, 0.078857, 0, 0.142862, 0.922342, 0.0756127, 0, 0.155674, 0.912842, 0.0721473, 0, 0.168849, 0.903304, 0.0686195, 0, 0.182378, 0.89411, 0.0650589, 0, 0.196255, 0.885512, 0.0616022, 0, 0.210473, 0.877193, 0.0582434, 0, 0.225027, 0.86877, 0.0548979, 0, 0.239915, 0.860267, 0.0516095, 0, 0.255132, 0.851915, 0.048468, 0, 0.270678, 0.843912, 0.0454447, 0, 0.286551, 0.83604, 0.0425612, 0, 0.302751, 0.828245, 0.0398752, 0, 0.31928, 0.820159, 0.0373198, 0, 0.336138, 0.81167, 0.034916, 0, 0.35333, 0.802659, 0.0326402, 0, 0.370858, 0.793921, 0.0304901, 0, 0.388728, 0.784713, 0.0284857, 0, 0.406944, 0.774946, 0.0266186, 0, 0.425515, 0.76448, 0.0248593, 0, 0.444449, 0.753793, 0.0232114, 0, 0.463756, 0.743506, 0.0217039, 0, 0.483447, 0.732555, 0.0202841, 0, 0.503535, 0.720965, 0.0189648, 0, 0.524036, 0.709422, 0.0177189, 0, 0.544968, 0.697756, 0.0165626, 0, 0.56635, 0.685565, 0.015483, 0, 0.588208, 0.673987, 0.0144892, 0, 0.610569, 0.66244, 0.0135607, 0, 0.633466, 0.651675, 0.0126956, 0, 0.656936, 0.641598, 0.0118788, 0, 0.681025, 0.63121, 0.0111261, 0, 0.705788, 0.620514, 0.010437, 0, 0.731289, 0.609366, 0.00978747, 0, 0.757606, 0.598137, 0.00917257, 0, 0.784834, 0.586966, 0.00859778, 0, 0.813085, 0.575549, 0.00806803, 0, 0.842485, 0.563797, 0.00757294, 0, 0.87313, 0.551758, 0.00710592, 0, 0.904762, 0.539894, 0.0066841, 0, 0.936508, 0.527901, 0.00627901, 0, 0.968254, 0.515819, 0.00590506, 0, 1, 1, 0.120864, 0, 0, 1, 0.120864, 0, 0, 0.999996, 0.120864, 0, 0, 0.99998, 0.120867, 0, 0, 0.99994, 0.120872, 0, 0.000323781, 0.999852, 0.120884, 0, 0.00188693, 0.999693, 0.120903, 0, 0.00473489, 0.999426, 0.120929, 0, 0.00872704, 0.999002, 0.120955, 0, 0.0137237, 0.998235, 0.120918, 0, 0.0196068, 0.994608, 0.119764, 0, 0.0262803, 0.992997, 0.119265, 0, 0.0336657, 0.990968, 0.11863, 0, 0.0416987, 0.987002, 0.117261, 0, 0.0503261, 0.983524, 0.116009, 0, 0.0595035, 0.97875, 0.114252, 0, 0.0691935, 0.972652, 0.11193, 0, 0.0793645, 0.966613, 0.109555, 0, 0.0899894, 0.959275, 0.106612, 0, 0.101045, 0.951272, 0.103375, 0, 0.112512, 0.942323, 0.0996594, 0, 0.124372, 0.933679, 0.0958841, 0, 0.136611, 0.924822, 0.0919265, 0, 0.149216, 0.915742, 0.0878061, 0, 0.162176, 0.906348, 0.0834894, 0, 0.175482, 0.896883, 0.079085, 0, 0.189125, 0.88774, 0.0746745, 0, 0.203098, 0.87986, 0.0705773, 0, 0.217396, 0.871998, 0.0665005, 0, 0.232015, 0.864325, 0.0625413, 0, 0.24695, 0.856685, 0.0586781, 0, 0.2622, 0.84925, 0.0550063, 0, 0.277761, 0.841719, 0.0514727, 0, 0.293634, 0.834755, 0.0481398, 0, 0.309819, 0.827853, 0.0450172, 0, 0.326315, 0.820888, 0.0420969, 0, 0.343126, 0.813616, 0.0393702, 0, 0.360254, 0.805767, 0.0367771, 0, 0.377701, 0.797338, 0.0343274, 0, 0.395474, 0.789122, 0.0320529, 0, 0.413577, 0.780601, 0.0299485, 0, 0.432018, 0.771424, 0.0279812, 0, 0.450804, 0.761502, 0.0261054, 0, 0.469944, 0.751166, 0.0243942, 0, 0.489451, 0.741276, 0.0228087, 0, 0.509337, 0.730898, 0.0213265, 0, 0.529617, 0.719878, 0.0199307, 0, 0.550307, 0.708379, 0.0186574, 0, 0.571428, 0.697165, 0.0174446, 0, 0.593003, 0.685554, 0.0163144, 0, 0.615059, 0.673631, 0.015276, 0, 0.637628, 0.662385, 0.0143003, 0, 0.660746, 0.651059, 0.0134112, 0, 0.68446, 0.640451, 0.0125794, 0, 0.70882, 0.630536, 0.011793, 0, 0.733893, 0.620316, 0.0110547, 0, 0.759756, 0.609722, 0.0103668, 0, 0.786505, 0.598804, 0.00973009, 0, 0.814259, 0.587871, 0.00912812, 0, 0.843157, 0.577121, 0.00858916, 0, 0.87334, 0.566019, 0.00807333, 0, 0.904762, 0.554664, 0.00759687, 0, 0.936508, 0.543101, 0.00714759, 0, 0.968254, 0.531558, 0.00673418, 0, 1, 1, 0.146767, 0, 0, 1, 0.146767, 0, 0, 0.999997, 0.146767, 0, 0, 0.999977, 0.146765, 0, 3.20658e-06, 0.999929, 0.146762, 0, 0.000682576, 0.999823, 0.146753, 0, 0.00276402, 0.999633, 0.146735, 0, 0.00614771, 0.999314, 0.146699, 0, 0.0106613, 0.998796, 0.14662, 0, 0.0161546, 0.997124, 0.146107, 0, 0.0225063, 0.994062, 0.144857, 0, 0.0296198, 0.992154, 0.144011, 0, 0.037417, 0.989186, 0.142712, 0, 0.0458348, 0.985279, 0.140926, 0, 0.0548211, 0.980826, 0.13885, 0, 0.0643326, 0.975056, 0.136168, 0, 0.074333, 0.969005, 0.133217, 0, 0.0847917, 0.961554, 0.12959, 0, 0.0956828, 0.954206, 0.125886, 0, 0.106984, 0.945046, 0.121335, 0, 0.118675, 0.935678, 0.116492, 0, 0.130741, 0.926748, 0.111635, 0, 0.143166, 0.917764, 0.106625, 0, 0.155939, 0.908358, 0.101325, 0, 0.169049, 0.899219, 0.0960249, 0, 0.182487, 0.890089, 0.0906527, 0, 0.196245, 0.881488, 0.0853905, 0, 0.210317, 0.874031, 0.0804177, 0, 0.224697, 0.866932, 0.0756005, 0, 0.23938, 0.859976, 0.0709019, 0, 0.254364, 0.853375, 0.0664391, 0, 0.269646, 0.846971, 0.0622012, 0, 0.285223, 0.840483, 0.058129, 0, 0.301096, 0.833969, 0.0542762, 0, 0.317265, 0.82806, 0.0507042, 0, 0.333729, 0.822128, 0.047368, 0, 0.350491, 0.815989, 0.044272, 0, 0.367554, 0.809336, 0.0413444, 0, 0.38492, 0.802177, 0.038601, 0, 0.402594, 0.79441, 0.0360227, 0, 0.420582, 0.786573, 0.0336383, 0, 0.438891, 0.778619, 0.0314321, 0, 0.457527, 0.77, 0.029362, 0, 0.476499, 0.760698, 0.0274102, 0, 0.49582, 0.750932, 0.0256146, 0, 0.5155, 0.740993, 0.023974, 0, 0.535555, 0.731159, 0.0224182, 0, 0.556, 0.720836, 0.0209889, 0, 0.576855, 0.709913, 0.0196411, 0, 0.598143, 0.698415, 0.0183824, 0, 0.619888, 0.68745, 0.0172222, 0, 0.642123, 0.676154, 0.0161509, 0, 0.664883, 0.664383, 0.0151397, 0, 0.688211, 0.6533, 0.0141873, 0, 0.71216, 0.642072, 0.0133105, 0, 0.736792, 0.631412, 0.0124932, 0, 0.762186, 0.621622, 0.0117408, 0, 0.788439, 0.611681, 0.0110358, 0, 0.815672, 0.60142, 0.0103775, 0, 0.844034, 0.59083, 0.00975623, 0, 0.873699, 0.580254, 0.00918084, 0, 0.904765, 0.569841, 0.00864721, 0, 0.936508, 0.559224, 0.00815731, 0, 0.968254, 0.548315, 0.00767924, 0, 1, 1, 0.177563, 0, 0, 1, 0.177563, 0, 0, 0.999994, 0.177562, 0, 0, 0.999972, 0.177555, 0, 6.64171e-05, 0.999914, 0.177536, 0, 0.0012276, 0.999787, 0.177496, 0, 0.00388025, 0.999556, 0.17742, 0, 0.00783463, 0.999165, 0.177285, 0, 0.0128953, 0.9985, 0.177037, 0, 0.0189053, 0.995388, 0.175634, 0, 0.025742, 0.993102, 0.174375, 0, 0.033309, 0.990992, 0.173121, 0, 0.0415298, 0.986932, 0.170896, 0, 0.0503425, 0.982786, 0.16847, 0, 0.0596964, 0.977592, 0.165455, 0, 0.0695498, 0.971075, 0.161676, 0, 0.0798676, 0.963967, 0.157458, 0, 0.0906201, 0.956397, 0.152836, 0, 0.101783, 0.947489, 0.147467, 0, 0.113333, 0.937564, 0.14145, 0, 0.125254, 0.928182, 0.135383, 0, 0.137529, 0.919027, 0.129212, 0, 0.150144, 0.909618, 0.12276, 0, 0.163088, 0.900492, 0.116273, 0, 0.176351, 0.891671, 0.1098, 0, 0.189924, 0.883146, 0.103362, 0, 0.203799, 0.875151, 0.0970799, 0, 0.21797, 0.868338, 0.0911732, 0, 0.232433, 0.862033, 0.0854966, 0, 0.247182, 0.856107, 0.0800691, 0, 0.262216, 0.850644, 0.0749618, 0, 0.27753, 0.845261, 0.070079, 0, 0.293124, 0.839885, 0.0654321, 0, 0.308997, 0.834609, 0.0610975, 0, 0.325149, 0.829083, 0.0569741, 0, 0.341581, 0.82404, 0.0531736, 0, 0.358294, 0.818968, 0.049665, 0, 0.37529, 0.813496, 0.0463856, 0, 0.392573, 0.807533, 0.0433217, 0, 0.410148, 0.80099, 0.0404402, 0, 0.428019, 0.793891, 0.0377578, 0, 0.446192, 0.786281, 0.0352616, 0, 0.464676, 0.778773, 0.0329577, 0, 0.483478, 0.770737, 0.030808, 0, 0.502608, 0.762094, 0.0287964, 0, 0.522079, 0.752898, 0.0269254, 0, 0.541905, 0.743306, 0.0251926, 0, 0.5621, 0.733416, 0.023595, 0, 0.582684, 0.723742, 0.0221155, 0, 0.603677, 0.713542, 0.0207435, 0, 0.625106, 0.702755, 0.019434, 0, 0.646998, 0.691484, 0.0182046, 0, 0.66939, 0.680531, 0.0170771, 0, 0.692324, 0.66953, 0.0160339, 0, 0.715849, 0.658126, 0.0150677, 0, 0.740028, 0.646933, 0.0141551, 0, 0.764937, 0.636107, 0.0133179, 0, 0.790673, 0.625271, 0.0125284, 0, 0.817358, 0.615225, 0.0117937, 0, 0.84515, 0.605678, 0.0111181, 0, 0.874244, 0.59583, 0.0104759, 0, 0.904828, 0.585704, 0.00986672, 0, 0.936508, 0.575413, 0.00929712, 0, 0.968254, 0.565373, 0.00876713, 0, 1, 1, 0.214058, 0, 0, 0.999999, 0.214058, 0, 0, 0.999994, 0.214055, 0, 0, 0.999966, 0.214039, 0, 0.000259642, 0.999893, 0.213998, 0, 0.00200075, 0.999737, 0.21391, 0, 0.00527775, 0.999449, 0.213745, 0, 0.00983959, 0.99896, 0.213458, 0, 0.0154755, 0.9979, 0.212855, 0, 0.0220249, 0.994278, 0.210779, 0, 0.0293654, 0.992254, 0.20926, 0, 0.0374021, 0.98881, 0.206908, 0, 0.0460604, 0.984715, 0.204009, 0, 0.0552802, 0.979738, 0.200471, 0, 0.0650127, 0.972884, 0.195813, 0, 0.0752175, 0.965996, 0.190856, 0, 0.0858612, 0.957974, 0.185077, 0, 0.0969155, 0.949155, 0.17868, 0, 0.108356, 0.939288, 0.171513, 0, 0.120163, 0.928996, 0.163838, 0, 0.132319, 0.919563, 0.156246, 0, 0.144808, 0.910004, 0.148359, 0, 0.157618, 0.900791, 0.140417, 0, 0.170737, 0.892135, 0.132569, 0, 0.184155, 0.883803, 0.124741, 0, 0.197866, 0.876034, 0.117091, 0, 0.211861, 0.869219, 0.109835, 0, 0.226134, 0.863062, 0.102859, 0, 0.240682, 0.857795, 0.0962928, 0, 0.255499, 0.853009, 0.0900725, 0, 0.270583, 0.848603, 0.0842101, 0, 0.285931, 0.844335, 0.0786527, 0, 0.301542, 0.840208, 0.0734397, 0, 0.317415, 0.836035, 0.0685334, 0, 0.33355, 0.83172, 0.0639275, 0, 0.349948, 0.827135, 0.0595909, 0, 0.36661, 0.822797, 0.0556204, 0, 0.383539, 0.818387, 0.0519394, 0, 0.400738, 0.813565, 0.0485317, 0, 0.41821, 0.808142, 0.0453138, 0, 0.435961, 0.802212, 0.0423354, 0, 0.453997, 0.79573, 0.0395553, 0, 0.472324, 0.788741, 0.036988, 0, 0.490951, 0.781093, 0.0345688, 0, 0.509887, 0.773597, 0.0323297, 0, 0.529144, 0.765622, 0.0302719, 0, 0.548735, 0.757083, 0.0283477, 0, 0.568674, 0.747992, 0.0265562, 0, 0.588979, 0.738591, 0.0248844, 0, 0.609671, 0.728719, 0.0233342, 0, 0.630773, 0.719146, 0.0219081, 0, 0.652314, 0.709165, 0.0205711, 0, 0.674328, 0.69875, 0.0193248, 0, 0.696854, 0.687884, 0.0181582, 0, 0.719942, 0.676818, 0.0170746, 0, 0.743651, 0.666247, 0.0160718, 0, 0.768057, 0.655284, 0.0151262, 0, 0.793253, 0.64401, 0.0142561, 0, 0.819363, 0.633353, 0.0134327, 0, 0.846547, 0.622674, 0.012653, 0, 0.875017, 0.612265, 0.0119354, 0, 0.905021, 0.602455, 0.0112533, 0, 0.936508, 0.593147, 0.0106234, 0, 0.968254, 0.583592, 0.0100213, 0, 1, 1, 0.25717, 0, 0, 1, 0.25717, 0, 0, 0.999992, 0.257164, 0, 0, 0.999958, 0.257135, 0, 0.000641715, 0.999864, 0.25706, 0, 0.00305314, 0.999666, 0.256897, 0, 0.00700975, 0.999302, 0.256596, 0, 0.0122194, 0.998663, 0.25607, 0, 0.0184622, 0.995607, 0.254123, 0, 0.0255773, 0.993094, 0.252081, 0, 0.0334439, 0.9907, 0.249867, 0, 0.0419696, 0.98594, 0.246118, 0, 0.0510823, 0.981214, 0.242049, 0, 0.0607242, 0.974966, 0.236869, 0, 0.0708486, 0.967589, 0.230724, 0, 0.081417, 0.95915, 0.223635, 0, 0.0923974, 0.950257, 0.21596, 0, 0.103763, 0.940165, 0.207296, 0, 0.115491, 0.929396, 0.197901, 0, 0.127562, 0.919288, 0.188437, 0, 0.13996, 0.909428, 0.178762, 0, 0.15267, 0.900105, 0.169072, 0, 0.165679, 0.891418, 0.159478, 0, 0.178979, 0.883347, 0.15002, 0, 0.192558, 0.875992, 0.140813, 0, 0.20641, 0.869466, 0.13196, 0, 0.220529, 0.863699, 0.123501, 0, 0.234907, 0.858553, 0.115436, 0, 0.249542, 0.854379, 0.107901, 0, 0.264428, 0.850894, 0.10088, 0, 0.279564, 0.847632, 0.0942296, 0, 0.294947, 0.844571, 0.0879861, 0, 0.310575, 0.84163, 0.0821534, 0, 0.326448, 0.838542, 0.0766409, 0, 0.342566, 0.835412, 0.0715322, 0, 0.358929, 0.831899, 0.0666883, 0, 0.37554, 0.828177, 0.0622175, 0, 0.392399, 0.82416, 0.0580452, 0, 0.409511, 0.820393, 0.054267, 0, 0.426878, 0.816068, 0.0507172, 0, 0.444506, 0.811201, 0.0474041, 0, 0.4624, 0.805785, 0.0443174, 0, 0.480566, 0.799878, 0.0414562, 0, 0.499013, 0.793469, 0.0388147, 0, 0.517749, 0.786473, 0.0363453, 0, 0.536785, 0.778874, 0.0340225, 0, 0.556134, 0.771277, 0.0318599, 0, 0.575809, 0.763426, 0.0298859, 0, 0.595827, 0.755044, 0.0280357, 0, 0.616207, 0.746161, 0.0262979, 0, 0.636973, 0.737124, 0.0247295, 0, 0.65815, 0.72761, 0.0232514, 0, 0.679772, 0.717822, 0.0218755, 0, 0.701876, 0.708279, 0.0205942, 0, 0.724509, 0.698333, 0.0193947, 0, 0.74773, 0.68802, 0.0182717, 0, 0.771609, 0.677321, 0.0172044, 0, 0.79624, 0.666504, 0.0162122, 0, 0.821743, 0.656184, 0.0152924, 0, 0.84828, 0.64556, 0.0144326, 0, 0.876069, 0.634636, 0.0136157, 0, 0.905404, 0.624124, 0.0128612, 0, 0.936508, 0.613914, 0.0121435, 0, 0.968254, 0.603589, 0.0114887, 0, 1, 1, 0.307946, 0, 0, 0.999999, 0.307945, 0, 0, 0.999988, 0.307934, 0, 2.04479e-05, 0.999944, 0.307886, 0, 0.00127833, 0.999824, 0.307756, 0, 0.00445047, 0.999565, 0.30748, 0, 0.00914673, 0.999085, 0.306966, 0, 0.0150498, 0.998103, 0.306004, 0, 0.0219367, 0.994249, 0.303028, 0, 0.0296485, 0.991807, 0.300435, 0, 0.038068, 0.987773, 0.296554, 0, 0.0471062, 0.982673, 0.2916, 0, 0.0566942, 0.976623, 0.285641, 0, 0.0667768, 0.968757, 0.27815, 0, 0.0773099, 0.959849, 0.269529, 0, 0.088257, 0.950663, 0.260248, 0, 0.0995879, 0.940129, 0.249704, 0, 0.111277, 0.92895, 0.238291, 0, 0.123304, 0.917996, 0.226501, 0, 0.13565, 0.907813, 0.214669, 0, 0.148299, 0.898305, 0.202835, 0, 0.161237, 0.889626, 0.191158, 0, 0.174455, 0.88175, 0.179695, 0, 0.187941, 0.874715, 0.168548, 0, 0.201687, 0.868746, 0.15792, 0, 0.215687, 0.863703, 0.147807, 0, 0.229933, 0.859315, 0.138149, 0, 0.24442, 0.855538, 0.128993, 0, 0.259145, 0.852428, 0.120414, 0, 0.274103, 0.850168, 0.112498, 0, 0.289293, 0.848132, 0.105054, 0, 0.304711, 0.846291, 0.0981087, 0, 0.320357, 0.844431, 0.0915942, 0, 0.33623, 0.842493, 0.0855056, 0, 0.35233, 0.840368, 0.0798204, 0, 0.368658, 0.83798, 0.0745097, 0, 0.385214, 0.83523, 0.0695424, 0, 0.402002, 0.832091, 0.0649092, 0, 0.419023, 0.828667, 0.0606291, 0, 0.436282, 0.824805, 0.0566523, 0, 0.453782, 0.820988, 0.0530229, 0, 0.471529, 0.816635, 0.0496364, 0, 0.489528, 0.811725, 0.0464658, 0, 0.507788, 0.806316, 0.0435082, 0, 0.526317, 0.800469, 0.0407873, 0, 0.545124, 0.794107, 0.038255, 0, 0.564221, 0.787218, 0.0358825, 0, 0.583621, 0.779872, 0.0336785, 0, 0.603341, 0.772097, 0.0316379, 0, 0.623397, 0.764484, 0.0297379, 0, 0.643812, 0.756428, 0.0279581, 0, 0.664611, 0.748022, 0.0263153, 0, 0.685824, 0.739268, 0.0247799, 0, 0.707488, 0.73024, 0.0233385, 0, 0.729646, 0.720893, 0.0220035, 0, 0.752354, 0.71119, 0.0207555, 0, 0.77568, 0.701791, 0.0195843, 0, 0.799715, 0.692184, 0.0184891, 0, 0.824574, 0.682258, 0.0174541, 0, 0.850417, 0.67206, 0.0164873, 0, 0.877466, 0.661717, 0.0155959, 0, 0.90604, 0.651462, 0.0147519, 0, 0.936528, 0.641467, 0.0139727, 0, 0.968254, 0.631229, 0.0132363, 0, 1, 1, 0.367573, 0, 0, 0.999999, 0.367571, 0, 0, 0.999984, 0.367553, 0, 0.000183382, 0.999925, 0.367473, 0, 0.00225254, 0.999759, 0.367259, 0, 0.00628165, 0.99941, 0.366801, 0, 0.0117858, 0.998739, 0.365946, 0, 0.0184359, 0.995529, 0.363191, 0, 0.0260114, 0.992875, 0.360171, 0, 0.0343581, 0.989135, 0.355981, 0, 0.0433637, 0.984166, 0.350401, 0, 0.0529438, 0.977871, 0.343348, 0, 0.0630334, 0.96951, 0.334341, 0, 0.0735805, 0.959964, 0.323862, 0, 0.0845437, 0.950162, 0.312521, 0, 0.095889, 0.938882, 0.299577, 0, 0.107588, 0.926992, 0.285573, 0, 0.119617, 0.915589, 0.271212, 0, 0.131957, 0.904791, 0.256611, 0, 0.144591, 0.895177, 0.242224, 0, 0.157503, 0.886403, 0.227952, 0, 0.170682, 0.878957, 0.214192, 0, 0.184117, 0.872418, 0.200795, 0, 0.197799, 0.867029, 0.188015, 0, 0.21172, 0.862835, 0.175975, 0, 0.225873, 0.859411, 0.164526, 0, 0.240253, 0.856655, 0.153693, 0, 0.254854, 0.854519, 0.14352, 0, 0.269673, 0.852828, 0.13397, 0, 0.284707, 0.851412, 0.124984, 0, 0.299953, 0.850609, 0.116748, 0, 0.315408, 0.849855, 0.10905, 0, 0.331073, 0.849017, 0.101839, 0, 0.346946, 0.848079, 0.0951359, 0, 0.363028, 0.846911, 0.0888774, 0, 0.379318, 0.845445, 0.0830375, 0, 0.395818, 0.84362, 0.0775844, 0, 0.41253, 0.841411, 0.0725054, 0, 0.429457, 0.838768, 0.0677691, 0, 0.446602, 0.835801, 0.0634016, 0, 0.463968, 0.832341, 0.0593095, 0, 0.481561, 0.828424, 0.0555121, 0, 0.499386, 0.824312, 0.052024, 0, 0.51745, 0.819918, 0.0487865, 0, 0.535761, 0.815072, 0.0457801, 0, 0.554328, 0.809863, 0.0430184, 0, 0.573162, 0.804164, 0.0404245, 0, 0.592275, 0.798034, 0.0380146, 0, 0.611681, 0.791436, 0.0357436, 0, 0.631398, 0.784498, 0.0336475, 0, 0.651445, 0.777125, 0.0316666, 0, 0.671845, 0.769365, 0.0298122, 0, 0.692628, 0.761579, 0.0281001, 0, 0.713827, 0.753746, 0.0265049, 0, 0.735484, 0.745573, 0.0250067, 0, 0.75765, 0.737083, 0.0236026, 0, 0.78039, 0.728545, 0.0223302, 0, 0.803789, 0.719691, 0.0211243, 0, 0.82796, 0.710569, 0.0199983, 0, 0.853056, 0.701216, 0.0189569, 0, 0.879298, 0.692094, 0.0179702, 0, 0.907014, 0.682909, 0.0170418, 0, 0.936691, 0.673509, 0.0161732, 0, 0.968254, 0.663863, 0.0153406, 0, 1, 1, 0.437395, 0, 0, 0.999998, 0.437394, 0, 0, 0.99998, 0.437363, 0, 0.000616704, 0.999891, 0.437232, 0, 0.00367925, 0.999656, 0.436877, 0, 0.00867446, 0.999148, 0.436121, 0, 0.0150679, 0.997959, 0.434564, 0, 0.022531, 0.993464, 0.430134, 0, 0.0308507, 0.990606, 0.426077, 0, 0.0398805, 0.985027, 0.419397, 0, 0.0495148, 0.978491, 0.41118, 0, 0.0596749, 0.969643, 0.40048, 0, 0.0703001, 0.959189, 0.38769, 0, 0.0813427, 0.948223, 0.373575, 0, 0.0927641, 0.935955, 0.357622, 0, 0.104533, 0.923237, 0.34043, 0, 0.116624, 0.911074, 0.322735, 0, 0.129015, 0.899724, 0.30479, 0, 0.141687, 0.890189, 0.287392, 0, 0.154626, 0.881796, 0.270248, 0, 0.167818, 0.874781, 0.253659, 0, 0.181252, 0.869166, 0.237786, 0, 0.194918, 0.864725, 0.222618, 0, 0.208807, 0.861565, 0.208356, 0, 0.222913, 0.859284, 0.194867, 0, 0.237229, 0.857677, 0.18212, 0, 0.25175, 0.856714, 0.17018, 0, 0.266473, 0.856155, 0.158969, 0, 0.281392, 0.8558, 0.148413, 0, 0.296505, 0.855672, 0.138578, 0, 0.311811, 0.855538, 0.129345, 0, 0.327306, 0.855689, 0.120861, 0, 0.342991, 0.855767, 0.112969, 0, 0.358864, 0.855618, 0.105593, 0, 0.374925, 0.85525, 0.0987451, 0, 0.391176, 0.854583, 0.0923727, 0, 0.407616, 0.853534, 0.0864143, 0, 0.424249, 0.852061, 0.0808338, 0, 0.441076, 0.850253, 0.0756771, 0, 0.4581, 0.848004, 0.0708612, 0, 0.475324, 0.845333, 0.0663784, 0, 0.492754, 0.842376, 0.0622631, 0, 0.510394, 0.838956, 0.0584112, 0, 0.528251, 0.835121, 0.0548328, 0, 0.546331, 0.830842, 0.0514838, 0, 0.564644, 0.826212, 0.048355, 0, 0.583198, 0.821522, 0.0454714, 0, 0.602005, 0.816551, 0.0428263, 0, 0.621078, 0.811211, 0.0403612, 0, 0.640434, 0.805479, 0.038039, 0, 0.660089, 0.799409, 0.0358739, 0, 0.680066, 0.79306, 0.0338727, 0, 0.70039, 0.786395, 0.0319985, 0, 0.721094, 0.779416, 0.030241, 0, 0.742215, 0.77214, 0.0285951, 0, 0.7638, 0.764636, 0.0270747, 0, 0.785912, 0.756836, 0.0256354, 0, 0.808628, 0.749315, 0.0243027, 0, 0.832055, 0.741561, 0.0230497, 0, 0.856338, 0.733589, 0.0218801, 0, 0.88169, 0.725479, 0.020784, 0, 0.908441, 0.717255, 0.0197702, 0, 0.937125, 0.708829, 0.0188168, 0, 0.968254, 0.700191, 0.0179113, 0, 1, 1, 0.518937, 0, 0, 0.999998, 0.518933, 0, 0, 0.999967, 0.518883, 0, 0.00147741, 0.999832, 0.51866, 0, 0.00573221, 0.999466, 0.518057, 0, 0.011826, 0.998644, 0.516752, 0, 0.0192116, 0.994458, 0.512347, 0, 0.027573, 0.991223, 0.507675, 0, 0.0367099, 0.985515, 0.500188, 0, 0.046487, 0.978308, 0.490408, 0, 0.0568071, 0.968359, 0.477357, 0, 0.0675984, 0.95682, 0.461752, 0, 0.0788059, 0.943929, 0.443796, 0, 0.090386, 0.930224, 0.423893, 0, 0.102304, 0.916514, 0.402682, 0, 0.114532, 0.903653, 0.380914, 0, 0.127047, 0.892315, 0.359212, 0, 0.139828, 0.882942, 0.338102, 0, 0.152861, 0.875438, 0.31773, 0, 0.16613, 0.869642, 0.298186, 0, 0.179624, 0.865304, 0.279491, 0, 0.193332, 0.862382, 0.261804, 0, 0.207247, 0.860666, 0.245146, 0, 0.22136, 0.859788, 0.229406, 0, 0.235666, 0.859608, 0.214605, 0, 0.250158, 0.859912, 0.200691, 0, 0.264832, 0.86053, 0.187623, 0, 0.279684, 0.861368, 0.17539, 0, 0.294711, 0.862237, 0.163901, 0, 0.309911, 0.863127, 0.153175, 0, 0.32528, 0.863923, 0.143147, 0, 0.340819, 0.864567, 0.133781, 0, 0.356524, 0.865013, 0.125042, 0, 0.372397, 0.86539, 0.116952, 0, 0.388438, 0.865591, 0.109476, 0, 0.404645, 0.865517, 0.102542, 0, 0.421022, 0.865084, 0.0960688, 0, 0.437569, 0.864309, 0.0900499, 0, 0.454287, 0.863151, 0.0844328, 0, 0.471181, 0.861649, 0.0792218, 0, 0.488253, 0.859742, 0.0743482, 0, 0.505507, 0.857446, 0.0697963, 0, 0.522947, 0.854757, 0.0655364, 0, 0.54058, 0.851783, 0.061608, 0, 0.558412, 0.848516, 0.0579701, 0, 0.576449, 0.844897, 0.0545742, 0, 0.594701, 0.840956, 0.0514167, 0, 0.613178, 0.836676, 0.0484598, 0, 0.631892, 0.832075, 0.0456934, 0, 0.650856, 0.827191, 0.0431178, 0, 0.670088, 0.822295, 0.0407718, 0, 0.689606, 0.817294, 0.0386032, 0, 0.709434, 0.812013, 0.0365675, 0, 0.7296, 0.806465, 0.0346547, 0, 0.750138, 0.800691, 0.0328717, 0, 0.771093, 0.794709, 0.031211, 0, 0.792519, 0.788493, 0.0296504, 0, 0.814488, 0.782049, 0.0281782, 0, 0.837097, 0.775403, 0.0267965, 0, 0.860481, 0.76857, 0.0255002, 0, 0.884842, 0.761536, 0.0242759, 0, 0.910494, 0.754303, 0.0231142, 0, 0.937985, 0.74692, 0.0220305, 0, 0.968254, 0.739745, 0.0210192, 0, 1, 1, 0.613914, 0, 0, 0.999996, 0.613907, 0, 9.63597e-05, 0.999942, 0.613814, 0, 0.00301247, 0.999704, 0.613407, 0, 0.00870385, 0.999046, 0.612302, 0, 0.0160714, 0.995516, 0.608266, 0, 0.0245899, 0.991726, 0.602863, 0, 0.0339681, 0.985157, 0.593956, 0, 0.0440254, 0.97642, 0.581748, 0, 0.0546409, 0.964404, 0.565183, 0, 0.0657284, 0.950601, 0.545273, 0, 0.0772246, 0.935158, 0.522129, 0, 0.0890812, 0.919364, 0.496782, 0, 0.10126, 0.904754, 0.470571, 0, 0.113731, 0.89176, 0.444037, 0, 0.126469, 0.881492, 0.418322, 0, 0.139454, 0.873656, 0.393522, 0, 0.15267, 0.868053, 0.369795, 0, 0.166101, 0.864336, 0.347171, 0, 0.179736, 0.862259, 0.325737, 0, 0.193565, 0.861556, 0.305532, 0, 0.207578, 0.861776, 0.286416, 0, 0.221769, 0.862661, 0.268355, 0, 0.23613, 0.864015, 0.251334, 0, 0.250656, 0.865711, 0.235352, 0, 0.265343, 0.867519, 0.220302, 0, 0.280187, 0.869351, 0.206161, 0, 0.295183, 0.871144, 0.192908, 0, 0.31033, 0.872839, 0.180505, 0, 0.325624, 0.874307, 0.168848, 0, 0.341065, 0.875667, 0.158021, 0, 0.35665, 0.876758, 0.147877, 0, 0.37238, 0.87764, 0.138441, 0, 0.388253, 0.878237, 0.129627, 0, 0.404269, 0.878563, 0.121415, 0, 0.42043, 0.878572, 0.113741, 0, 0.436735, 0.87842, 0.106652, 0, 0.453187, 0.878057, 0.100097, 0, 0.469786, 0.877413, 0.0940128, 0, 0.486536, 0.87646, 0.0883462, 0, 0.503439, 0.875233, 0.0830924, 0, 0.520498, 0.8737, 0.0781975, 0, 0.537717, 0.871873, 0.07364, 0, 0.555102, 0.86978, 0.0694103, 0, 0.572657, 0.867405, 0.0654696, 0, 0.59039, 0.864751, 0.0617914, 0, 0.608307, 0.861818, 0.0583491, 0, 0.626419, 0.858645, 0.0551443, 0, 0.644733, 0.855307, 0.0521894, 0, 0.663264, 0.851736, 0.0494334, 0, 0.682025, 0.847927, 0.0468504, 0, 0.701032, 0.843888, 0.0444261, 0, 0.720308, 0.839629, 0.0421497, 0, 0.739875, 0.835158, 0.0400082, 0, 0.759764, 0.830509, 0.0380076, 0, 0.780014, 0.825714, 0.0361488, 0, 0.800673, 0.820729, 0.0343956, 0, 0.821803, 0.815751, 0.0327781, 0, 0.843492, 0.810752, 0.031275, 0, 0.86586, 0.805587, 0.0298542, 0, 0.889087, 0.800317, 0.0285397, 0, 0.913466, 0.79489, 0.0272948, 0, 0.93952, 0.789314, 0.0261139, 0, 0.96835, 0.783593, 0.0249938, 0, 1, 1, 0.724258, 0, 0, 0.999992, 0.724243, 0, 0.000726889, 0.99987, 0.724044, 0, 0.00569574, 0.999336, 0.72317, 0, 0.0131702, 0.996271, 0.719432, 0, 0.0220738, 0.991159, 0.712576, 0, 0.0319405, 0.982465, 0.700927, 0, 0.0425202, 0.97049, 0.684297, 0, 0.0536599, 0.953973, 0.661244, 0, 0.065258, 0.935546, 0.633804, 0, 0.0772427, 0.916596, 0.603071, 0, 0.0895616, 0.899353, 0.57105, 0, 0.102175, 0.885216, 0.539206, 0, 0.11505, 0.875076, 0.508714, 0, 0.128164, 0.868334, 0.479571, 0, 0.141495, 0.864414, 0.451796, 0, 0.155026, 0.862678, 0.425328, 0, 0.168745, 0.862835, 0.400352, 0, 0.182639, 0.864067, 0.376532, 0, 0.196699, 0.866086, 0.35391, 0, 0.210915, 0.868557, 0.332424, 0, 0.225282, 0.871271, 0.312053, 0, 0.239792, 0.874058, 0.292764, 0, 0.25444, 0.8768, 0.27453, 0, 0.269223, 0.87939, 0.257297, 0, 0.284135, 0.8819, 0.24114, 0, 0.299174, 0.884187, 0.225934, 0, 0.314337, 0.886262, 0.211669, 0, 0.329622, 0.888119, 0.198311, 0, 0.345026, 0.889709, 0.185783, 0, 0.360549, 0.891054, 0.174063, 0, 0.376189, 0.892196, 0.163143, 0, 0.391946, 0.893101, 0.152952, 0, 0.407819, 0.893803, 0.143475, 0, 0.423808, 0.894277, 0.134647, 0, 0.439914, 0.894532, 0.126434, 0, 0.456137, 0.894576, 0.1188, 0, 0.472479, 0.894393, 0.111694, 0, 0.48894, 0.893976, 0.105069, 0, 0.505523, 0.893346, 0.0989077, 0, 0.52223, 0.892502, 0.0931724, 0, 0.539064, 0.891441, 0.0878276, 0, 0.556028, 0.890276, 0.082903, 0, 0.573125, 0.888972, 0.0783505, 0, 0.590361, 0.887469, 0.0741083, 0, 0.607741, 0.885785, 0.0701633, 0, 0.62527, 0.883914, 0.0664835, 0, 0.642957, 0.881872, 0.0630567, 0, 0.660809, 0.879651, 0.0598527, 0, 0.678836, 0.877267, 0.0568615, 0, 0.69705, 0.874717, 0.05406, 0, 0.715465, 0.872012, 0.0514378, 0, 0.734098, 0.869157, 0.0489805, 0, 0.752968, 0.866155, 0.0466727, 0, 0.772101, 0.863014, 0.0445056, 0, 0.791529, 0.859748, 0.0424733, 0, 0.81129, 0.856416, 0.0405957, 0, 0.831438, 0.852958, 0.0388273, 0, 0.852044, 0.849382, 0.0371619, 0, 0.87321, 0.845694, 0.0355959, 0, 0.89509, 0.841893, 0.0341155, 0, 0.917932, 0.837981, 0.0327141, 0, 0.942204, 0.833963, 0.0313856, 0, 0.968981, 0.829847, 0.0301275, 0, 1, 1, 0.85214, 0, 0, 0.999969, 0.852095, 0, 0.00279627, 0.999483, 0.851408, 0, 0.0107635, 0.994545, 0.84579, 0, 0.0206454, 0.986188, 0.835231, 0, 0.0315756, 0.969847, 0.814687, 0, 0.0432021, 0.945951, 0.783735, 0, 0.0553396, 0.91917, 0.746074, 0, 0.0678766, 0.895488, 0.706938, 0, 0.0807395, 0.878232, 0.669534, 0, 0.0938767, 0.868252, 0.635168, 0, 0.10725, 0.863873, 0.603069, 0, 0.120832, 0.863369, 0.572514, 0, 0.134598, 0.86545, 0.543169, 0, 0.148533, 0.868803, 0.514578, 0, 0.16262, 0.872794, 0.486762, 0, 0.176849, 0.87702, 0.459811, 0, 0.19121, 0.881054, 0.433654, 0, 0.205694, 0.884974, 0.408574, 0, 0.220294, 0.888587, 0.384525, 0, 0.235005, 0.891877, 0.36156, 0, 0.24982, 0.894793, 0.339661, 0, 0.264737, 0.89743, 0.318913, 0, 0.279751, 0.899796, 0.299302, 0, 0.294859, 0.901943, 0.280843, 0, 0.310058, 0.903858, 0.263481, 0, 0.325346, 0.905574, 0.247197, 0, 0.340721, 0.907069, 0.231915, 0, 0.356181, 0.908379, 0.217614, 0, 0.371725, 0.90952, 0.20425, 0, 0.387353, 0.910483, 0.191758, 0, 0.403063, 0.91128, 0.180092, 0, 0.418854, 0.911936, 0.169222, 0, 0.434727, 0.912454, 0.159098, 0, 0.450682, 0.912835, 0.149668, 0, 0.466718, 0.913078, 0.140884, 0, 0.482837, 0.913192, 0.132709, 0, 0.499038, 0.913175, 0.125095, 0, 0.515324, 0.91304, 0.118012, 0, 0.531695, 0.912781, 0.111417, 0, 0.548153, 0.91241, 0.105281, 0, 0.5647, 0.911924, 0.0995691, 0, 0.581338, 0.911331, 0.0942531, 0, 0.59807, 0.910637, 0.0893076, 0, 0.6149, 0.90984, 0.0846998, 0, 0.63183, 0.908941, 0.0804044, 0, 0.648865, 0.907944, 0.0763984, 0, 0.666011, 0.906857, 0.0726638, 0, 0.683273, 0.90568, 0.0691783, 0, 0.700659, 0.904416, 0.0659222, 0, 0.718176, 0.903067, 0.0628782, 0, 0.735834, 0.901637, 0.0600307, 0, 0.753646, 0.900128, 0.0573647, 0, 0.771625, 0.898544, 0.0548668, 0, 0.78979, 0.89689, 0.052527, 0, 0.808162, 0.895165, 0.0503306, 0, 0.826771, 0.893371, 0.0482668, 0, 0.845654, 0.891572, 0.0463605, 0, 0.864863, 0.889763, 0.0445998, 0, 0.884472, 0.887894, 0.0429451, 0, 0.904592, 0.885967, 0.0413884, 0, 0.925407, 0.883984, 0.0399225, 0, 0.947271, 0.881945, 0.0385405, 0, 0.97105, 0.879854, 0.0372362, 0, 1, 0.999804, 0.995833, 0, 0, 0.938155, 0.933611, 0, 0.0158731, 0.864755, 0.854311, 0, 0.0317461, 0.888594, 0.865264, 0, 0.0476191, 0.905575, 0.863922, 0, 0.0634921, 0.915125, 0.850558, 0, 0.0793651, 0.920665, 0.829254, 0, 0.0952381, 0.924073, 0.802578, 0, 0.111111, 0.926304, 0.772211, 0, 0.126984, 0.927829, 0.739366, 0, 0.142857, 0.928924, 0.705033, 0, 0.15873, 0.92973, 0.670019, 0, 0.174603, 0.930339, 0.634993, 0, 0.190476, 0.930811, 0.600485, 0, 0.206349, 0.931191, 0.566897, 0, 0.222222, 0.93149, 0.534485, 0, 0.238095, 0.931737, 0.503429, 0, 0.253968, 0.931939, 0.473811, 0, 0.269841, 0.932108, 0.445668, 0, 0.285714, 0.93225, 0.418993, 0, 0.301587, 0.932371, 0.393762, 0, 0.31746, 0.932474, 0.369939, 0, 0.333333, 0.932562, 0.347479, 0, 0.349206, 0.932638, 0.326336, 0, 0.365079, 0.932703, 0.306462, 0, 0.380952, 0.93276, 0.287805, 0, 0.396825, 0.932809, 0.270313, 0, 0.412698, 0.932851, 0.253933, 0, 0.428571, 0.932887, 0.23861, 0, 0.444444, 0.932917, 0.224289, 0, 0.460317, 0.932943, 0.210917, 0, 0.47619, 0.932965, 0.19844, 0, 0.492063, 0.932982, 0.186807, 0, 0.507937, 0.932995, 0.175966, 0, 0.52381, 0.933005, 0.165869, 0, 0.539683, 0.933011, 0.156468, 0, 0.555556, 0.933013, 0.147719, 0, 0.571429, 0.933013, 0.139579, 0, 0.587302, 0.93301, 0.132007, 0, 0.603175, 0.933004, 0.124965, 0, 0.619048, 0.932994, 0.118416, 0, 0.634921, 0.932982, 0.112326, 0, 0.650794, 0.932968, 0.106663, 0, 0.666667, 0.93295, 0.101397, 0, 0.68254, 0.932931, 0.0964993, 0, 0.698413, 0.932908, 0.0919438, 0, 0.714286, 0.932883, 0.0877057, 0, 0.730159, 0.932856, 0.0837623, 0, 0.746032, 0.932827, 0.0800921, 0, 0.761905, 0.932796, 0.0766754, 0, 0.777778, 0.932762, 0.0734936, 0, 0.793651, 0.932727, 0.0705296, 0, 0.809524, 0.932689, 0.0677676, 0, 0.825397, 0.93265, 0.0651929, 0, 0.84127, 0.932609, 0.0627917, 0, 0.857143, 0.932565, 0.0605515, 0, 0.873016, 0.932521, 0.0584606, 0, 0.888889, 0.932474, 0.0565082, 0, 0.904762, 0.932427, 0.0546841, 0, 0.920635, 0.932377, 0.0529793, 0, 0.936508, 0.932326, 0.0513851, 0, 0.952381, 0.932274, 0.0498936, 0, 0.968254, 0.93222, 0.0484975, 0, 0.984127, 0.932164, 0.0471899, 0, 1 ]; // data textures

			const ltc_float_1 = new Float32Array( LTC_MAT_1 );
			const ltc_float_2 = new Float32Array( LTC_MAT_2 );
			THREE.UniformsLib.LTC_FLOAT_1 = new THREE.DataTexture( ltc_float_1, 64, 64, THREE.RGBAFormat, THREE.FloatType, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.NearestFilter, 1 );
			THREE.UniformsLib.LTC_FLOAT_2 = new THREE.DataTexture( ltc_float_2, 64, 64, THREE.RGBAFormat, THREE.FloatType, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.NearestFilter, 1 );
			const ltc_half_1 = new Uint16Array( LTC_MAT_1.length );
			LTC_MAT_1.forEach( function ( x, index ) {

				ltc_half_1[ index ] = THREE.DataUtils.toHalfFloat( x );

			} );
			const ltc_half_2 = new Uint16Array( LTC_MAT_2.length );
			LTC_MAT_2.forEach( function ( x, index ) {

				ltc_half_2[ index ] = THREE.DataUtils.toHalfFloat( x );

			} );
			THREE.UniformsLib.LTC_HALF_1 = new THREE.DataTexture( ltc_half_1, 64, 64, THREE.RGBAFormat, THREE.HalfFloatType, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.NearestFilter, 1 );
			THREE.UniformsLib.LTC_HALF_2 = new THREE.DataTexture( ltc_half_2, 64, 64, THREE.RGBAFormat, THREE.HalfFloatType, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.NearestFilter, 1 );

		}

	}

	THREE.RectAreaLightUniformsLib = RectAreaLightUniformsLib;

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
		transparency: 'Transparency', thickness: 'Distortion (thickness)', wave: 'Ripples', tint: 'Glass colour', tint_distance: 'Colour depth (0 = clear)', glass_name: 'Glass', water_name: 'Water', wave_speed: 'Ripples moving (speed)', wave_size: 'Ripple density',
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
		light_flicker: 'Flicker', light_flicker_amount: 'Flicker amount', light_flicker_speed: 'Flicker speed', fl_none: 'None (steady)', fl_candle: 'Candle', fl_fire: 'Fire', fl_fluorescent: 'Failing fluorescent tube', fl_broken: 'Loose contact (goes off)', fl_strobe: 'Strobe', fl_pulse: 'Slow pulse',
		light_kind: 'Kind', lk_point: 'Point (bulb)', lk_spot: 'Spot (torch, stage light)', lk_area: 'Area (window, panel)', light_angle: 'Cone angle', light_softness: 'Soft edge', light_area_w: 'Width (px)', light_area_h: 'Height (px)',
		lights: 'Lights', add_light: '+ Light', light_title: 'Light', light_strength: 'Strength', light_radius: 'Radius (px)', light_shadows: 'Shadows',
		light_hint: 'A light is an empty group. Move it with the Move tool; a spot and an area light shine along the group\'s -Z axis (turn it with Rotate). It shines in the Render view.', light_selected: 'Selected light',
		cameras: 'Cameras', add_camera: '+ Camera', camera_title: 'Camera', camera_selected: 'Selected camera',
		cam_look: 'Look through this camera', cam_looking: 'Looking through it (click to leave)', cam_fov: 'Field of view',
		cam_lens: 'Lens', cam_distortion: 'Corner distortion', cam_distortion_tip: 'Negative = pincushion, positive = barrel (fisheye)', cam_chroma: 'Chromatic aberration',
		vid_action: 'Render video (MP4)…', vid_action_desc: 'The animation seen through a camera, with every effect, as an MP4 file', vid_title: 'Render video',
		vid_camera: 'Camera', vid_view: 'The current view', vid_size: 'Size', vid_vertical: 'vertical', vid_fps: 'Frames per second', vid_start: 'From (seconds)', vid_end: 'To (seconds)',
		vid_effects: 'Effects', vid_fx_all: 'All on (AO, reflections, bloom, motion blur…)', vid_fx_project: 'As set in the Render panel',
		vid_quality: 'Quality', vid_q_draft: 'Draft (small file)', vid_q_normal: 'Normal', vid_q_high: 'High', vid_q_max: 'Maximum (large file)',
		vid_hint: 'Every frame is made one by one, so the video has exactly this frame rate however heavy the scene is (a slow computer only needs more time). Skybox, bloom, motion blur, depth of field and the camera lens effects are included. The animation is the one selected in the Animate tab.',
		vid_cancel: 'Cancel', vid_busy: 'A video is already being rendered', vid_frame: 'Frame', vid_fps_render: 'frames/s', vid_s_frame: 's per frame', vid_left: 'left about', vid_sec: 's',
		vid_done: 'Video saved', vid_error: 'Video failed', vid_no_encoder: 'This Blockbench cannot encode video (no H.264 or VP9 encoder found). Update Blockbench or use a screen recorder.',
		cam_bloom: 'Glow (bloom) strength', cam_motion: 'Motion blur', motion_blur: 'Motion blur (camera)', cam_look_fx: 'Look', cam_vignette: 'Vignette', cam_grain: 'Film grain', cam_saturation: 'Saturation', cam_contrast: 'Contrast', cam_temperature: 'Warm / cold',
		cam_focus: 'Focus', cam_focus_pick: 'Focus on selected', cam_focus_clear: 'Clear', cam_focus_blur: 'Background blur', cam_focus_none: 'nothing',
		cam_hint: 'A camera is an empty group looking along its -Z axis. Turn it with Rotate, move it with Move; the effects apply in the Render view while you look through it.',
		rt: 'Ray tracing', rt_rays: 'Rays per pixel', rt_distance: 'Ray length (px)', rt_bounce: 'Bounce light (colour bleeding)', rt_ao: 'Occlusion (shade in corners)',
		rt_shadows: 'Contact shadows (sun)', rt_accumulate: 'Clean up while standing still', rt_video_samples: 'Passes per video frame', rt_video_samples_tip: 'Every frame of a video is traced this many times and averaged: more = less noise, slower',
		rt_hint: 'Rays are traced through what the camera sees: light bounces off nearby surfaces and colours them, corners get darker, small objects cast sharp contact shadows. While nothing moves the frames add up and the noise goes away. What is off screen or hidden behind something cannot be hit.',
		gloss: 'Reflections by roughness', gloss_strength: 'Strength', gloss_distance: 'Reflection reach (px)', gloss_rays: 'Rays (rough surfaces)',
		gloss_hint: 'Every material mirrors what the camera sees: sharp on smooth ones, blurred on rough ones, coloured on metals, stronger at grazing angles. Set roughness and metalness in Materials.',
		fog: 'Volumetric fog', fog_density: 'Density', fog_color: 'Fog colour', fog_brightness: 'Fog brightness (sky)', fog_base: 'Fog level (height, px)',
		fog_height: 'Thinning with height (px)', fog_noise: 'Clumps', fog_noise_size: 'Clump size (px)', fog_wind: 'Wind (px/s)', fog_wind_dir: 'Wind direction',
		fog_light: 'Light in the fog', fog_anisotropy: 'Glow toward the light', fog_distance: 'Range (px)', fog_quality: 'Quality (steps)', fog_shafts: 'Light shafts (sun shadows)',
		fog_hint: 'Fog lit by the sky, the sun and every light (a glow around lamps, flickering with them). With sun shadows on, objects cut light shafts into it. The wind moves the clumps by animation time.',
		particles_title: 'Particles', act_particles: 'Particles…', act_particles_desc: 'Make the selected object give off particles (smoke, sparks, snow…) and open the Particles panel',
		act_add_particles: 'Add particles', act_add_particles_desc: 'Add a particle emitter (an empty group) at the current view',
		pt_hint_none: 'Select an object with particles.', pt_remove: 'Remove', pt_restart: 'Start again', pt_enabled: 'On',
		pt_amount: 'Amount and time', pt_count: 'Count (at once)', pt_lifetime: 'Lifetime (s)', pt_life_jitter: 'Lifetime spread', pt_fade_in: 'Appearing (s)', pt_fade_out: 'Disappearing (s)',
		pt_prewarm: 'Already full at the start', pt_prewarm_tip: 'Off: the particles start coming out at time 0 of the animation (or when switched on)',
		pt_look: 'Look', pt_color: 'Colour at birth', pt_color_end: 'Colour at the end', pt_size: 'Size at birth', pt_size_end: 'Size at the end', pt_size_jitter: 'Size spread',
		pt_spin: 'Spin', pt_glow: 'Glow (bloom in the Render view)', pt_additive: 'Add light (fire, sparks)', pt_additive_tip: 'The particles brighten what is behind them instead of covering it',
		pt_motion: 'Motion', pt_direction: 'Direction', pd_up: 'Up', pd_down: 'Down', pd_sideways: 'Sideways (around)', pd_all: 'Every way', pd_custom: 'Own direction',
		pt_yaw: 'Turn', pt_pitch: 'Tilt', pt_local: 'Turn with the object', pt_spread: 'Spread (cone)', pt_speed: 'Speed (px/s)', pt_speed_jitter: 'Speed spread',
		pt_gravity: 'Gravity', pt_gravity_tip: 'Positive pulls down, negative lifts (smoke, steam)', pt_drag: 'Air drag', pt_shape: 'Come out of', ps_point: 'The centre', ps_box: 'The whole object (its volume)',
		pt_follow: 'Move with the object', pt_follow_tip: 'On: all particles move along when the object moves. Off: they stay where they came out (a trail)',
		pt_hint: 'The particles are worked out from the time: in the Animate tab they follow the timeline (scrub it back and they go back too) and a video renders them exactly the same.',
		pt_collide: 'Hit solid objects', pt_collide_tip: 'The particles stop on the cubes and meshes of the scene and on the floor (bounce or stick) instead of flying through them', pt_stick: 'Stick where they hit', pt_bounce: 'Bounce', pt_friction: 'Friction',
		pt_sheet: 'Sprite sheet', pt_sheet_cols: 'Columns', pt_sheet_rows: 'Rows', pt_sheet_tip: 'A texture made of several frames in a grid (an animated flame, smoke puffs): how many across and down', pt_sheet_mode: 'Frames', psm_life: 'Over the lifetime', psm_fps: 'At a frame rate (loop)', psm_random: 'One random frame each', pt_sheet_fps: 'Frames per second',
		ptx_dot: 'Soft dot', ptx_smoke: 'Smoke', ptx_spark: 'Spark', ptx_fire: 'Flame', ptx_snow: 'Snowflake', ptx_drop: 'Drop', ptx_star: 'Star', ptx_square: 'Square',
		decals: 'Decals', decal: 'Decal', decal_image: 'Picture', decal_size: 'Size', decal_angle: 'Turn', decal_width: 'Width', decal_height: 'Height', decal_depth: 'Depth (how far it wraps)',
		decal_place: 'Place decal (click an object)', decal_placing: 'Placing: click an object (Esc to stop)', decal_place_msg: 'Click an object to put the decal there. Esc stops.', decal_miss: 'No object there', decals_of: 'Decals of',
		decal_hint: 'A decal wraps over the shape like a sticker and moves with the element. Tip: hold Ctrl while dragging a texture onto an object to put it on every face and fit the UV map into the texture.',
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
		transparency: 'Прозрачность', thickness: 'Искажение (толщина)', wave: 'Волны / неровность', tint: 'Цвет стекла', tint_distance: 'Глубина цвета (0 — прозрачное)', glass_name: 'Стекло', water_name: 'Вода', wave_speed: 'Движение волн (скорость)', wave_size: 'Частота волн',
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
		light_flicker: 'Мерцание', light_flicker_amount: 'Сила мерцания', light_flicker_speed: 'Скорость мерцания', fl_none: 'Нет (ровный)', fl_candle: 'Свеча', fl_fire: 'Огонь / костёр', fl_fluorescent: 'Барахлящая лампа дневного света', fl_broken: 'Плохой контакт (гаснет)', fl_strobe: 'Стробоскоп', fl_pulse: 'Медленная пульсация',
		light_kind: 'Тип', lk_point: 'Точечный (лампочка)', lk_spot: 'Прожектор (фонарь, софит)', lk_area: 'Площадной (окно, панель)', light_angle: 'Угол конуса', light_softness: 'Мягкий край', light_area_w: 'Ширина (px)', light_area_h: 'Высота (px)',
		lights: 'Свет', add_light: '+ Свет', light_title: 'Свет', light_strength: 'Сила', light_radius: 'Радиус (px)', light_shadows: 'Тени',
		light_hint: 'Свет — это пустая группа. Двигайте её «Перемещением»; прожектор и площадной свет светят вдоль оси -Z группы (поворачивайте «Вращением»). Светит в Рендер-виде.', light_selected: 'Выбранный свет',
		cameras: 'Камеры', add_camera: '+ Камера', camera_title: 'Камера', camera_selected: 'Выбранная камера',
		cam_look: 'Смотреть через эту камеру', cam_looking: 'Смотрим через неё (нажмите, чтобы выйти)', cam_fov: 'Угол обзора',
		cam_lens: 'Объектив', cam_distortion: 'Искажение углов', cam_distortion_tip: 'Минус = подушка, плюс = бочка (рыбий глаз)', cam_chroma: 'Хроматическая аберрация',
		vid_action: 'Рендер видео (MP4)…', vid_action_desc: 'Анимация от лица камеры со всеми эффектами в файл MP4', vid_title: 'Рендер видео',
		vid_camera: 'Камера', vid_view: 'Текущий вид', vid_size: 'Размер', vid_vertical: 'вертикальное', vid_fps: 'Кадров в секунду', vid_start: 'С (секунды)', vid_end: 'До (секунды)',
		vid_effects: 'Эффекты', vid_fx_all: 'Все включены (AO, отражения, свечение, размытие…)', vid_fx_project: 'Как в панели Render',
		vid_quality: 'Качество', vid_q_draft: 'Черновик (маленький файл)', vid_q_normal: 'Обычное', vid_q_high: 'Высокое', vid_q_max: 'Максимум (большой файл)',
		vid_hint: 'Каждый кадр делается отдельно, поэтому в видео ровно столько кадров в секунду, сколько выбрано, как бы тяжела ни была сцена (на слабом компьютере просто дольше). Скайбокс, свечение, размытие в движении, глубина резкости и эффекты объектива камеры включены. Берётся анимация, выбранная на вкладке «Анимация».',
		vid_cancel: 'Отмена', vid_busy: 'Видео уже рендерится', vid_frame: 'Кадр', vid_fps_render: 'кадров/с', vid_s_frame: 'с на кадр', vid_left: 'осталось около', vid_sec: 'с',
		vid_done: 'Видео сохранено', vid_error: 'Видео не получилось', vid_no_encoder: 'Этот Blockbench не умеет кодировать видео (нет кодировщика H.264 или VP9). Обновите Blockbench или запишите экран.',
		cam_bloom: 'Сила свечения (bloom)', cam_motion: 'Размытие в движении', motion_blur: 'Размытие в движении (камера)', cam_look_fx: 'Картинка', cam_vignette: 'Виньетка', cam_grain: 'Плёночное зерно', cam_saturation: 'Насыщенность', cam_contrast: 'Контраст', cam_temperature: 'Тепло / холод',
		cam_focus: 'Фокус', cam_focus_pick: 'Фокус на выделенном', cam_focus_clear: 'Сбросить', cam_focus_blur: 'Размытие фона', cam_focus_none: 'ничего',
		cam_hint: 'Камера — пустая группа, смотрящая вдоль своей оси -Z. Поворачивайте «Вращением», двигайте «Перемещением»; эффекты работают в Рендер-виде, пока вы смотрите через неё.',
		rt: 'Трассировка лучей', rt_rays: 'Лучей на пиксель', rt_distance: 'Длина луча (px)', rt_bounce: 'Отражённый свет (переносит цвет)', rt_ao: 'Затенение в углах',
		rt_shadows: 'Контактные тени (солнце)', rt_accumulate: 'Очищать шум, пока всё стоит', rt_video_samples: 'Проходов на кадр видео', rt_video_samples_tip: 'Каждый кадр видео трассируется столько раз, и результаты усредняются: больше — меньше шума, но дольше',
		rt_hint: 'Лучи идут по тому, что видит камера: свет отражается от соседних поверхностей и окрашивает их, углы темнеют, мелкие предметы дают чёткие контактные тени. Пока ничего не двигается, кадры складываются и шум уходит. То, что за кадром или скрыто за другим объектом, лучи не находят.',
		gloss: 'Отражения по шероховатости', gloss_strength: 'Сила', gloss_distance: 'Дальность отражений (px)', gloss_rays: 'Лучей (шероховатые)',
		gloss_hint: 'Каждый материал отражает то, что видит камера: чётко на гладком, размыто на шероховатом, с цветом на металле и сильнее под острым углом. Шероховатость и металличность задаются в «Материалах».',
		fog: 'Объёмный туман', fog_density: 'Плотность', fog_color: 'Цвет тумана', fog_brightness: 'Яркость тумана (небо)', fog_base: 'Уровень тумана (высота, px)',
		fog_height: 'Редеет с высотой (px)', fog_noise: 'Клочья', fog_noise_size: 'Размер клочьев (px)', fog_wind: 'Ветер (px/с)', fog_wind_dir: 'Направление ветра',
		fog_light: 'Свет в тумане', fog_anisotropy: 'Сияние к источнику', fog_distance: 'Дальность (px)', fog_quality: 'Качество (шагов)', fog_shafts: 'Лучи света (тени солнца)',
		fog_hint: 'Туман освещается небом, солнцем и каждым источником света (ореол вокруг ламп, мерцает вместе с ними). Если у солнца включены тени, объекты прорезают в тумане лучи света. Ветер двигает клочья по времени анимации.',
		particles_title: 'Частицы', act_particles: 'Частицы…', act_particles_desc: 'Выделенный объект начинает испускать частицы (дым, искры, снег…), открывается панель «Частицы»',
		act_add_particles: 'Добавить частицы', act_add_particles_desc: 'Добавить источник частиц (пустая группа) в текущем ракурсе',
		pt_hint_none: 'Выделите объект с частицами.', pt_remove: 'Убрать', pt_restart: 'Запустить заново', pt_enabled: 'Включены',
		pt_amount: 'Количество и время', pt_count: 'Количество (одновременно)', pt_lifetime: 'Время жизни (с)', pt_life_jitter: 'Разброс времени жизни', pt_fade_in: 'Появление (с)', pt_fade_out: 'Исчезновение (с)',
		pt_prewarm: 'Сразу заполнено', pt_prewarm_tip: 'Выкл: частицы начинают вылетать с момента 0 анимации (или с момента включения)',
		pt_look: 'Вид', pt_color: 'Цвет при появлении', pt_color_end: 'Цвет в конце', pt_size: 'Размер при появлении', pt_size_end: 'Размер в конце', pt_size_jitter: 'Разброс размера',
		pt_spin: 'Вращение', pt_glow: 'Свечение (bloom в Рендер-виде)', pt_additive: 'Светящиеся (огонь, искры)', pt_additive_tip: 'Частицы осветляют то, что за ними, а не закрывают его',
		pt_motion: 'Движение', pt_direction: 'Направление', pd_up: 'Вверх', pd_down: 'Вниз', pd_sideways: 'В стороны (по кругу)', pd_all: 'Во все стороны', pd_custom: 'Своё направление',
		pt_yaw: 'Поворот', pt_pitch: 'Наклон', pt_local: 'Поворачивать с объектом', pt_spread: 'Разброс (конус)', pt_speed: 'Скорость (px/с)', pt_speed_jitter: 'Разброс скорости',
		pt_gravity: 'Гравитация', pt_gravity_tip: 'Плюс тянет вниз, минус поднимает (дым, пар)', pt_drag: 'Сопротивление воздуха', pt_shape: 'Откуда вылетают', ps_point: 'Из центра', ps_box: 'Из всего объекта (его объёма)',
		pt_follow: 'Двигаются вместе с объектом', pt_follow_tip: 'Вкл: все частицы смещаются вместе с объектом. Выкл: остаются там, где вылетели (шлейф)',
		pt_hint: 'Частицы рассчитываются по времени: во вкладке «Анимация» они идут по таймлайну (перемотали назад — частицы тоже вернулись), а в видео получаются точно такими же.',
		pt_collide: 'Сталкиваются с твёрдыми объектами', pt_collide_tip: 'Частицы останавливаются на кубах, мешах сцены и на полу (отскакивают или прилипают), а не пролетают сквозь них', pt_stick: 'Прилипают при ударе', pt_bounce: 'Упругость (отскок)', pt_friction: 'Трение',
		pt_sheet: 'Спрайтшит (кадры)', pt_sheet_cols: 'Колонок', pt_sheet_rows: 'Строк', pt_sheet_tip: 'Текстура из нескольких кадров сеткой (анимированный огонь, клубы дыма): сколько кадров по горизонтали и вертикали', pt_sheet_mode: 'Кадры', psm_life: 'За время жизни', psm_fps: 'С частотой (по кругу)', psm_random: 'Случайный кадр у каждой', pt_sheet_fps: 'Кадров в секунду',
		ptx_dot: 'Мягкая точка', ptx_smoke: 'Дым', ptx_spark: 'Искра', ptx_fire: 'Пламя', ptx_snow: 'Снежинка', ptx_drop: 'Капля', ptx_star: 'Звезда', ptx_square: 'Квадрат',
		decals: 'Декали', decal: 'Декаль', decal_image: 'Картинка', decal_size: 'Размер', decal_angle: 'Поворот', decal_width: 'Ширина', decal_height: 'Высота', decal_depth: 'Глубина (насколько огибает)',
		decal_place: 'Поставить декаль (клик по объекту)', decal_placing: 'Ставим: кликните по объекту (Esc — стоп)', decal_place_msg: 'Кликните по объекту, чтобы поставить декаль. Esc — закончить.', decal_miss: 'Там нет объекта', decals_of: 'Декали объекта',
		decal_hint: 'Декаль огибает форму как наклейка и двигается вместе с объектом. Совет: зажмите Ctrl, перетаскивая текстуру на объект, — она ляжет на все грани, а развёртка впишется в текстуру.',
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
	bloom: true, bloom_strength: 0.35, bloom_threshold: 1.2, bloom_radius: 0.6, dof: false, dof_focus: 60, dof_blur: 0.5, fxaa: true, motion_blur: 0, vignette: 0.25,
	rt: false, rt_rays: 6, rt_distance: 40, rt_bounce: 1, rt_ao: 0.7, rt_shadows: 0.6, rt_accumulate: true, rt_video_samples: 8,
	gloss: false, gloss_strength: 1, gloss_distance: 300, gloss_rays: 3,
	fog: false, fog_density: 0.4, fog_color: '#c9d3df', fog_brightness: 0.35, fog_base: 0, fog_height: 30, fog_noise: 0.5, fog_noise_size: 40,
	fog_wind: 6, fog_wind_dir: 30, fog_light: 1, fog_anisotropy: 0.55, fog_distance: 600, fog_quality: 40, fog_shafts: true,
	sky_mode: 'off', sky_top: '#2f6fd6', sky_horizon: '#bcd8ff', sky_ground: '#6b5a48', sky_sun: true, sky_clouds: 0.4, sky_image: '', sky_image_name: '', sky_rotation: 0,
	};
const DEFAULT_MATERIAL = {
	name: 'Material', color: '#ffffff', map: null, roughness: 0.8, roughness_map: null, metalness: 0, metalness_map: null,
	normal_map: null, normal_strength: 1, emission: '#ffffff', emission_strength: 0, emission_map: null,
	opacity: 1, transmission: 0, ior: 1.45, clearcoat: 0, env: 0.6,
	thickness: 0, wave: 0, wave_speed: 0, wave_size: 2, tint: '#ffffff', tint_distance: 0,
};
// the glass that is always there: clear, refracting what is behind it (a thick pane bends it), a faint ripple in it
const WATER_ID = 'mat:water';
// water: clear, bending what is under it, blue-green when deep, with moving ripples
const WATER_MATERIAL = {color: '#ffffff', roughness: 0.03, metalness: 0, opacity: 1, transmission: 1, ior: 1.33, clearcoat: 0.4, env: 1.1,
	thickness: 10, wave: 0.7, wave_speed: 0.6, wave_size: 3, tint: '#3fa7b5', tint_distance: 30};
const GLASS_ID = 'mat:glass';
const GLASS_MATERIAL = {color: '#ffffff', roughness: 0.04, metalness: 0, opacity: 1, transmission: 1, ior: 1.5, clearcoat: 1, env: 1.2,
	thickness: 6, wave: 0.35, tint: '#d8f0ee', tint_distance: 40};
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
	if (!store[GLASS_ID]) store[GLASS_ID] = Object.assign({}, DEFAULT_MATERIAL, GLASS_MATERIAL, {name: tr('glass_name')});
	if (!store[WATER_ID]) store[WATER_ID] = Object.assign({}, DEFAULT_MATERIAL, WATER_MATERIAL, {name: tr('water_name')});
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
		// (see-through: what is behind it shows, inside too)
		depthWrite: d.opacity >= 0.98,
		transmission: d.transmission, ior: d.ior, clearcoat: d.clearcoat, clearcoatRoughness: 0.08,
		// how much it bends what is seen through it, and the colour the glass takes on when thick
		thickness: d.transmission > 0 ? d.thickness : 0,
		attenuationColor: new THREE.Color(d.tint || '#ffffff'), attenuationDistance: d.transmission > 0 && d.tint_distance > 0 ? d.tint_distance : 0,
		envMapIntensity: d.env * ((Project && settingsOf().sky_strength) ?? 1),
		alphaTest: d.opacity >= 1 && d.transmission == 0 ? 0.5 : 0,   // pixel art cut outs (transparent pixels in the texture)
		side: THREE.DoubleSide,
	});
	if (d.emission_strength > 0 && !m.emissiveMap && d.map) m.emissiveMap = m.map;
	// ripples in the glass (a wavy normal), when no normal map is set
	if (d.wave > 0 && !m.normalMap) {
		// moving ripples need a texture of their own (its offset slides with the time)
		const base = waveNormalTexture();
		const moving = d.wave_speed > 0 || (d.wave_size && d.wave_size != 2);
		m.normalMap = moving ? base.clone() : base;
		if (moving) { m.normalMap.needsUpdate = true; m.normalMap.repeat.set(d.wave_size || 2, d.wave_size || 2); }
		m.normalScale = new THREE.Vector2(d.wave, -d.wave);
		m.userData.wave_speed = d.wave_speed || 0;
	}
	m.userData.render_plugin = true;
	return m;
}

// a seamless wavy normal map (old window glass: slow uneven ripples)
let wave_texture = null;
function waveNormalTexture() {
	if (wave_texture) return wave_texture;
	const n = 128, data = new Uint8Array(n * n * 4), T = Math.PI * 2;
	const h = (x, y) => Math.sin(T * (x * 2 + y * 1)) * 0.5 + Math.sin(T * (x * 3 - y * 2) + 1.3) * 0.3 + Math.sin(T * (y * 5 + x) + 0.4) * 0.2 + Math.sin(T * (x * 7 + y * 4) + 2.1) * 0.08;
	for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const u = x / n, v = y / n, e = 1 / n;
		const dx = (h(u + e, v) - h(u - e, v)) / (2 * e), dy = (h(u, v + e) - h(u, v - e)) / (2 * e);
		const k = 0.04, len = Math.hypot(dx * k, dy * k, 1);
		data.set([(-dx * k / len * 0.5 + 0.5) * 255, (-dy * k / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255, 255].map(Math.round), (y * n + x) * 4);
	}
	wave_texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
	wave_texture.wrapS = wave_texture.wrapT = THREE.RepeatWrapping;
	wave_texture.repeat.set(2, 2);
	wave_texture.needsUpdate = true;
	return wave_texture;
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
	// the sky lives on the graphics card of one viewport: every viewport (the camera preview, a video render) gets its own copy
	return {group, sun, hemi, floor, renderer, skies: new Map([[renderer, {env, bg: null, key: ''}]]), saved_bg: scene.background, lights: new Map()};
}

function disposeRig() {
	if (!rig) return;
	scene.remove(rig.group);
	scene.background = rig.saved_bg;
	rig.skies.forEach(sk => { if (sk.env) sk.env.dispose(); if (sk.bg) sk.bg.dispose(); });
	rig.lights.forEach(l => l.dispose && l.dispose());
	rig = null;
}

function updateRig(renderer) {
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
	let sk = rig.skies.get(renderer);
	if (!sk) { sk = {env: null, bg: null, key: ''}; rig.skies.set(renderer, sk); }
	const key = s.sky_mode == 'off' ? 'flat|' + s.sky_color + s.ground_color : 'sky|' + skyKey(s);
	if (key != sk.key || !sk.env) {
	sk.key = key;
	const panorama = skyEquirect(s);   // null when off, or while a panorama image is still loading
	if (!panorama && s.sky_mode != 'off') sk.key = '';   // try again next frame
	const pmrem = new THREE.PMREMGenerator(renderer);
	const sky = panorama || skyTexture(s.sky_color, s.ground_color);
	if (sk.env) sk.env.dispose();
	sk.env = pmrem.fromEquirectangular(sky).texture;
	if (sk.bg) { sk.bg.dispose(); sk.bg = null; }
	if (panorama) {
		// a sharp copy for the background (the sky light above is the blurry one)
		sk.bg = new THREE.WebGLCubeRenderTarget(1024).fromEquirectangularTexture(renderer, panorama);
		sk.bg.texture.minFilter = THREE.LinearMipmapLinearFilter;
	}
	sky.dispose();
	pmrem.dispose();
	}
	scene.environment = sk.env;
	scene.background = sk.bg ? sk.bg.texture : rig.saved_bg;
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
		const hidden = hideForPasses(scene);
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

// Motion blur of the camera: every pixel is smeared along the way it travelled on the screen since the last frame.
// The way is found from the depth of the scene and the camera of the previous frame. Soft: a long way is eased out (never
// a hard streak), the taps are spread with noise and weighted like a bell, so there are no steps and no banding.
class MotionBlurPass extends THREE.Pass {
	constructor(scene, camera, w, h) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.amount = 0.5;
		this.depthTarget = new THREE.WebGLRenderTarget(w, h, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat});
		this.depthMaterial = new THREE.MeshDepthMaterial();
		this.depthMaterial.depthPacking = THREE.RGBADepthPacking;
		this.depthMaterial.blending = THREE.NoBlending;
		this.vp = new THREE.Matrix4();
		this.prev = new THREE.Matrix4();
		this.has_prev = false;
		this.last_time = 0;
		this.max_gap = 250;   // ms
		this.material = new THREE.ShaderMaterial({
			uniforms: {tDiffuse: {value: null}, tDepth: {value: null}, invVP: {value: new THREE.Matrix4()}, prevVP: {value: new THREE.Matrix4()}, amount: {value: 0.5}},
			vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: `
				uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform mat4 invVP; uniform mat4 prevVP; uniform float amount;
				varying vec2 vUv;
				const float UnpackDownscale = 255. / 256.;
				const vec3 PackFactors = vec3(256. * 256. * 256., 256. * 256., 256.);
				const vec4 UnpackFactors = UnpackDownscale / vec4(PackFactors, 1.);
				const int TAPS = 24;
				// a very bright pixel (or a broken one: infinity times a weight of 0 is not a number) must never poison the picture
				vec4 safe(vec4 c) {
					c = clamp(c, vec4(0.0), vec4(4000.0));
					if (!(c.r > -1.0 && c.g > -1.0 && c.b > -1.0)) c = vec4(0.0);   // not a number: comparisons with it are false
					return c;
				}
				void main() {
					float depth = dot(texture2D(tDepth, vUv), UnpackFactors);
					vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
					vec4 world = invVP * clip;
					world /= world.w;
					vec4 before = prevVP * world;
					vec2 uvBefore = before.xy / before.w * 0.5 + 0.5;
					vec2 v = (vUv - uvBefore) * amount * 0.75;
					float len = length(v);
					if (len < 0.0004) { gl_FragColor = safe(texture2D(tDiffuse, vUv)); return; }
					// a long way is eased out: it approaches the limit smoothly instead of being cut off
					float limit = 0.07;
					v *= limit * (1.0 - exp(-len / limit)) / len;
					float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
					vec4 sum = vec4(0.0);
					float total = 0.0;
					for (int i = 0; i < TAPS; i++) {
						float t = (float(i) + noise) / float(TAPS) - 0.5;
						float w = 0.5 + 0.5 * cos(t * 6.2831853);
						sum += safe(texture2D(tDiffuse, clamp(vUv + v * t, vec2(0.001), vec2(0.999)))) * w;
						total += w;
					}
					gl_FragColor = sum / total;
				}`,
			depthTest: false, depthWrite: false,
		});
		this.fsQuad = new THREE.FullScreenQuad(this.material);
	}
	setSize(w, h) { this.depthTarget.setSize(w, h); }
	dispose() { this.depthTarget.dispose(); this.depthMaterial.dispose(); this.material.dispose(); }
	render(renderer, writeBuffer, readBuffer) {
		const camera = this.camera, now = performance.now();
		camera.updateMatrixWorld(true);
		this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		// the camera of the last frame; after a pause there is no "last frame" to compare with
		if (!this.has_prev || now - this.last_time > this.max_gap) this.prev.copy(this.vp);
		let moved = 0;
		for (let i = 0; i < 16; i++) moved = Math.max(moved, Math.abs(this.vp.elements[i] - this.prev.elements[i]));
		this.last_time = now;
		this.has_prev = true;
		if (moved < 1e-5 || this.amount <= 0) {   // standing still: nothing to do, the picture goes on untouched
			this.needsSwap = false;
			this.prev.copy(this.vp);
			return;
		}
		this.needsSwap = true;
		const hidden = hideForPasses(this.scene);
		const background = this.scene.background, override = this.scene.overrideMaterial;
		this.scene.background = null;
		this.scene.overrideMaterial = this.depthMaterial;
		renderer.setRenderTarget(this.depthTarget);
		const clear = renderer.getClearColor(new THREE.Color()), clear_alpha = renderer.getClearAlpha();
		renderer.setClearColor(0xffffff, 1);
		renderer.clear();
		try {
			renderer.render(this.scene, camera);
		} finally {
			renderer.setClearColor(clear, clear_alpha);
			this.scene.overrideMaterial = override;
			this.scene.background = background;
			hidden.forEach(o => { o.visible = true; });
		}
		const u = this.material.uniforms;
		u.tDiffuse.value = readBuffer.texture;
		u.tDepth.value = this.depthTarget.texture;
		u.invVP.value.copy(this.vp).invert();
		u.prevVP.value.copy(this.prev);
		u.amount.value = this.amount;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this.fsQuad.render(renderer);
		this.prev.copy(this.vp);
	}
}

// what the extra passes must not see: Blockbench's helpers (lines, points, sprites, invisible planes) and the particles
function hideForPasses(sc) {
	const hidden = [];
	sc.traverseVisible(o => {
		if (o.isLine || o.isPoints || o.isSprite || o.userData.render_no_fx) hidden.push(o);
		else if (o.isMesh) {
			const m = o.material, list = Array.isArray(m) ? m : [m];
			if (!list.length || list.every(x => !x || x.visible === false || x.colorWrite === false)) hidden.push(o);
		}
	});
	hidden.forEach(o => { o.visible = false; });
	return hidden;
}

const FULLSCREEN_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// view space position from the stored distance, and back to the screen (perspective and orthographic cameras)
const VIEW_SPACE_GLSL = `
	uniform mat4 proj; uniform float ortho;
	vec3 viewPos(vec2 uv, float z) {
		vec2 ndc = uv * 2.0 - 1.0;
		if (ortho > 0.5) return vec3((ndc - vec2(proj[3][0], proj[3][1])) / vec2(proj[0][0], proj[1][1]), -z);
		return vec3((ndc + vec2(proj[2][0], proj[2][1])) * z / vec2(proj[0][0], proj[1][1]), -z);
	}
	vec2 toScreen(vec3 p) { vec4 c = proj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
	float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
	vec3 safe3(vec3 c) { c = clamp(c, vec3(0.0), vec3(3000.0)); if (!(c.r > -1.0 && c.g > -1.0 && c.b > -1.0)) c = vec3(0.0); return c; }
`;

// What the camera sees as geometry: the surface direction (view space) in rgb and the distance from the camera in alpha
// (0 = nothing there, the sky). Rendered once a frame and shared by the ray tracing and the fog.
class SceneBuffer {
	constructor(renderer, w, h) {
		const float = renderer.capabilities.isWebGL2 ? renderer.extensions.has('EXT_color_buffer_float') : renderer.extensions.has('OES_texture_float');
		this.target = new THREE.WebGLRenderTarget(w, h, {type: float ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true});
		this.material = new THREE.ShaderMaterial({
			vertexShader: `varying vec3 vN; varying float vZ;
				void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
			fragmentShader: `varying vec3 vN; varying float vZ;
				void main() { vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n, max(vZ, 0.001)); }`,
			side: THREE.DoubleSide, blending: THREE.NoBlending,
		});
	}
	setSize(w, h) { this.target.setSize(w, h); }
	dispose() { this.target.dispose(); this.material.dispose(); }
	render(renderer, sc, camera) {
		const hidden = hideForPasses(sc);
		const background = sc.background, override = sc.overrideMaterial;
		const clear = renderer.getClearColor(new THREE.Color()), clear_alpha = renderer.getClearAlpha();
		sc.background = null;
		sc.overrideMaterial = this.material;
		try {
			renderer.setRenderTarget(this.target);
			renderer.setClearColor(0x000000, 0);
			renderer.clear();
			renderer.render(sc, camera);
		} finally {
			renderer.setClearColor(clear, clear_alpha);
			sc.overrideMaterial = override;
			sc.background = background;
			hidden.forEach(o => { o.visible = true; });
		}
	}
}

// a blur that stays on its surface (does not bleed over edges in depth or across corners): removes the noise of the rays
const BilateralShader = {
	uniforms: {tInput: {value: null}, tGeo: {value: null}, step: {value: new THREE.Vector2()}},
	vertexShader: FULLSCREEN_VERTEX,
	fragmentShader: `uniform sampler2D tInput; uniform sampler2D tGeo; uniform vec2 step; varying vec2 vUv;
		void main() {
			vec4 g0 = texture2D(tGeo, vUv);
			float z0 = g0.a > 0.0 ? g0.a : 100000.0;
			vec4 sum = vec4(0.0); float total = 0.0;
			for (int i = -5; i <= 5; i++) {
				vec2 uv = vUv + step * float(i);
				vec4 g = texture2D(tGeo, uv);
				float z = g.a > 0.0 ? g.a : 100000.0;
				float w = exp(-float(i * i) / 12.0) * exp(-abs(z - z0) / (0.04 * z0 + 0.5));
				if (g.a > 0.0 && g0.a > 0.0) w *= pow(max(dot(g.xyz, g0.xyz), 0.0), 6.0);
				sum += texture2D(tInput, uv) * w; total += w;
			}
			gl_FragColor = sum / max(total, 1e-5);
		}`,
};

class BilateralBlur {
	constructor(w, h) {
		this.tmp = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
		this.material = new THREE.ShaderMaterial(Object.assign({}, BilateralShader, {uniforms: THREE.UniformsUtils.clone(BilateralShader.uniforms), depthTest: false, depthWrite: false}));
		this.quad = new THREE.FullScreenQuad(this.material);
		this.w = w; this.h = h;
	}
	setSize(w, h) { this.tmp.setSize(w, h); this.w = w; this.h = h; }
	dispose() { this.tmp.dispose(); this.material.dispose(); }
	// target -> blurred back into target
	run(renderer, target, geo, spread) {
		const u = this.material.uniforms;
		u.tGeo.value = geo;
		u.tInput.value = target.texture; u.step.value.set(spread / this.w, 0);
		renderer.setRenderTarget(this.tmp); this.quad.render(renderer);
		u.tInput.value = this.tmp.texture; u.step.value.set(0, spread / this.h);
		renderer.setRenderTarget(target); this.quad.render(renderer);
	}
}

// Ray tracing (in screen space). From every visible point rays go out over the half sphere above the surface and are marched
// through what the camera sees. A ray that hits something brings back the light of that surface (bounce light, colour bleeding)
// and counts as blocked (ambient occlusion); a ray toward the sun that hits something makes a contact shadow. The noise of the
// few rays is smoothed by a blur that stays on the surface, and while the camera and the animation stand still the frames are
// added up, so the picture gets cleaner by itself. Only what is on the screen can be hit (like every screen space effect).
class RayTracePass extends THREE.Pass {
	constructor(camera, buffer, w, h) {
		super();
		this.camera = camera;
		this.buffer = buffer;
		this.settings = {rays: 6, distance: 40, bounce: 1, ao: 0.7, shadows: 0.6, accumulate: true, video_samples: 8};
		this.sun_dir = new THREE.Vector3(0, 1, 0);
		this.offline = false;
		this.reset = false;
		const opts = {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false};
		this.trace = new THREE.WebGLRenderTarget(w, h, opts);
		this.history = [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
		this.blur = new BilateralBlur(w, h);
		this.frames = 0;
		this.frame_index = 0;
		this.prev = new THREE.Matrix4();
		this.traceMaterial = new THREE.ShaderMaterial({
			uniforms: {tColor: {value: null}, tGeo: {value: null}, proj: {value: new THREE.Matrix4()}, ortho: {value: 0}, frame: {value: 0}, rays: {value: 6},
				dist: {value: 40}, aoStrength: {value: 0.7}, shadowStrength: {value: 0.6}, sunDir: {value: new THREE.Vector3()}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: VIEW_SPACE_GLSL + `
				uniform sampler2D tColor; uniform sampler2D tGeo; uniform float frame; uniform float rays; uniform float dist;
				uniform float aoStrength; uniform float shadowStrength; uniform vec3 sunDir; varying vec2 vUv;
				const int MAX_RAYS = 24; const int STEPS = 16;
				void main() {
					vec4 g = texture2D(tGeo, vUv);
					if (g.a <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
					vec3 N = normalize(g.xyz), P = viewPos(vUv, g.a);
					float noise = fract(ign(gl_FragCoord.xy) + frame * 0.61803398);
					vec3 T = normalize(abs(N.y) < 0.95 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0))), B = cross(N, T);
					float bias = max(0.03, g.a * 0.0015);
					vec3 start = P + N * bias;
					vec3 gi = vec3(0.0); float occ = 0.0;
					for (int i = 0; i < MAX_RAYS; i++) {
						if (float(i) >= rays) break;
						// cosine weighted direction over the half sphere (a different set every frame)
						float u1 = fract(noise + (float(i) + 0.5) / rays);
						float u2 = fract(ign(gl_FragCoord.yx + float(i) * 7.31) + frame * 0.7548776);
						float r = sqrt(u1), phi = 6.2831853 * u2;
						vec3 dir = normalize(T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(max(0.0, 1.0 - u1)));
						float jitter = fract(noise * 5.37 + float(i) * 0.379);
						for (int j = 0; j < STEPS; j++) {
							float s = (float(j) + jitter) / float(STEPS);
							float t = dist * s * s + bias;
							vec3 Q = start + dir * t;
							vec2 uv = toScreen(Q);
							if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || Q.z > -0.01) break;
							vec4 h = texture2D(tGeo, uv);
							if (h.a <= 0.0) continue;
							float behind = -Q.z - h.a;
							if (behind > 0.02 && behind < max(1.5, t * 0.6)) {
								float near = 1.0 - s;
								occ += near;
								float facing = clamp(dot(normalize(h.xyz), -dir) * 1.5 + 0.2, 0.0, 1.0);
								gi += safe3(texture2D(tColor, uv).rgb) * facing;
								break;
							}
						}
					}
					gi /= rays;
					float ao = 1.0 - clamp(occ / rays * 2.0, 0.0, 1.0);
					// contact shadow: march toward the sun
					float lit = 1.0;
					if (shadowStrength > 0.0 && dot(N, sunDir) > 0.02) {
						for (int j = 0; j < 14; j++) {
							float t = dist * 0.6 * (float(j) + noise) / 14.0 + bias;
							vec3 Q = start + sunDir * t;
							vec2 uv = toScreen(Q);
							if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || Q.z > -0.01) break;
							vec4 h = texture2D(tGeo, uv);
							if (h.a <= 0.0) continue;
							float behind = -Q.z - h.a;
							if (behind > 0.05 && behind < max(2.0, t * 0.5)) { lit = 0.0; break; }
						}
					}
					gl_FragColor = vec4(gi, mix(1.0, ao, aoStrength) * mix(1.0, lit, shadowStrength * 0.75));
				}`,
			depthTest: false, depthWrite: false,
		});
		this.accumMaterial = new THREE.ShaderMaterial({
			uniforms: {tCurrent: {value: null}, tHistory: {value: null}, weight: {value: 1}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: `uniform sampler2D tCurrent; uniform sampler2D tHistory; uniform float weight; varying vec2 vUv;
				void main() { gl_FragColor = mix(texture2D(tHistory, vUv), texture2D(tCurrent, vUv), weight); }`,
			depthTest: false, depthWrite: false,
		});
		this.compositeMaterial = new THREE.ShaderMaterial({
			uniforms: {tColor: {value: null}, tRT: {value: null}, bounce: {value: 1}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: `uniform sampler2D tColor; uniform sampler2D tRT; uniform float bounce; varying vec2 vUv;
				void main() {
					vec4 src = texture2D(tColor, vUv);
					vec4 r = texture2D(tRT, vUv);
					vec3 c = src.rgb;
					// the colour of the surface itself, roughly: the lit colour with its brightness taken out
					float m = max(max(c.r, c.g), c.b);
					vec3 albedo = clamp(c / max(m, 0.35), 0.0, 1.0) * 0.75;
					gl_FragColor = vec4(c * r.a + r.rgb * albedo * bounce, src.a);
				}`,
			depthTest: false, depthWrite: false,
		});
		this.quad = new THREE.FullScreenQuad(null);
	}
	setSize(w, h) {
		this.trace.setSize(w, h);
		this.history.forEach(t => t.setSize(w, h));
		this.blur.setSize(w, h);
		this.frames = 0;
	}
	dispose() {
		this.trace.dispose(); this.history.forEach(t => t.dispose()); this.blur.dispose();
		this.traceMaterial.dispose(); this.accumMaterial.dispose(); this.compositeMaterial.dispose();
	}
	render(renderer, writeBuffer, readBuffer) {
		const s = this.settings, camera = this.camera;
		camera.updateMatrixWorld(true);
		const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		let moved = this.reset;
		for (let i = 0; i < 16 && !moved; i++) if (Math.abs(vp.elements[i] - this.prev.elements[i]) > 1e-6) moved = true;
		this.prev.copy(vp);
		this.reset = false;
		this.frame_index = (this.frame_index + 1) % 4096;
		const u = this.traceMaterial.uniforms;
		u.tColor.value = readBuffer.texture;
		u.tGeo.value = this.buffer.target.texture;
		u.proj.value.copy(camera.projectionMatrix);
		u.ortho.value = camera.isOrthographicCamera ? 1 : 0;
		u.frame.value = this.frame_index;
		u.rays.value = Math.max(1, Math.min(24, Math.round(s.rays * (this.offline ? 2 : 1))));
		u.dist.value = s.distance;
		u.aoStrength.value = s.ao;
		u.shadowStrength.value = s.shadows;
		u.sunDir.value.copy(this.sun_dir).transformDirection(camera.matrixWorldInverse);
		// a video frame is traced several times with other rays and the passes are averaged (no noise, nothing smeared);
		// in the viewport the frames are added up while nothing moves
		const passes = this.offline ? Math.max(1, Math.min(64, Math.round(s.video_samples || 8))) : 1;
		const accumulate = s.accumulate && !this.offline;
		let next = null;
		for (let pass = 0; pass < passes; pass++) {
			if (pass) { this.frame_index = (this.frame_index + 1) % 4096; u.frame.value = this.frame_index; }
			renderer.setRenderTarget(this.trace);
			this.quad.material = this.traceMaterial;
			this.quad.render(renderer);
			this.blur.run(renderer, this.trace, this.buffer.target.texture, this.offline ? 1 : 1.5);
			this.frames = this.offline ? pass + 1 : accumulate && !moved ? Math.min(this.frames + 1, 24) : 1;
			const [hist, nx] = this.history;
			this.accumMaterial.uniforms.tCurrent.value = this.trace.texture;
			this.accumMaterial.uniforms.tHistory.value = hist.texture;
			this.accumMaterial.uniforms.weight.value = 1 / this.frames;
			renderer.setRenderTarget(nx);
			this.quad.material = this.accumMaterial;
			this.quad.render(renderer);
			this.history = [nx, hist];
			next = nx;
		}
		const c = this.compositeMaterial.uniforms;
		c.tColor.value = readBuffer.texture;
		c.tRT.value = next.texture;
		c.bounce.value = s.bounce;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this.quad.material = this.compositeMaterial;
		this.quad.render(renderer);
	}
}

// Glossy reflections on every material: what the camera sees is mirrored in each surface, sharp on a smooth one and
// blurred on a rough one (the rays spread with the roughness), stronger at grazing angles (Fresnel) and coloured by metals.
// A material buffer says how rough and how metallic every pixel is.
class GlossyReflectionPass extends THREE.Pass {
	constructor(camera, buffer, w, h) {
		super();
		this.camera = camera;
		this.buffer = buffer;
		this.settings = {strength: 1, distance: 300, rays: 3, accumulate: true};
		this.offline = false;
		this.reset = false;
		this.frames = 0;
		this.frame_index = 0;
		this.prev = new THREE.Matrix4();
		const opts = {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false};
		this.materials = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true});
		this.trace = new THREE.WebGLRenderTarget(w, h, opts);
		this.history = [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
		this.blur = new BilateralBlur(w, h);
		this.material_cache = new Map();
		this.traceMaterial = new THREE.ShaderMaterial({
			uniforms: {tColor: {value: null}, tGeo: {value: null}, tMat: {value: null}, proj: {value: new THREE.Matrix4()}, ortho: {value: 0}, frame: {value: 0}, rays: {value: 3}, dist: {value: 300}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: VIEW_SPACE_GLSL + `
				uniform sampler2D tColor; uniform sampler2D tGeo; uniform sampler2D tMat; uniform float frame; uniform float rays; uniform float dist; varying vec2 vUv;
				const int MAX_RAYS = 8; const int STEPS = 28;
				void main() {
					vec4 g = texture2D(tGeo, vUv), m = texture2D(tMat, vUv);
					float rough = m.r, metal = m.g;
					if (g.a <= 0.0 || m.a < 0.5 || (rough > 0.92 && metal < 0.1)) { gl_FragColor = vec4(0.0); return; }
					vec3 N = normalize(g.xyz), P = viewPos(vUv, g.a);
					vec3 V = ortho > 0.5 ? vec3(0.0, 0.0, -1.0) : normalize(P);
					vec3 R = reflect(V, N);
					vec3 T = normalize(abs(R.y) < 0.95 ? cross(R, vec3(0.0, 1.0, 0.0)) : cross(R, vec3(1.0, 0.0, 0.0))), B = cross(R, T);
					float noise = fract(ign(gl_FragCoord.xy) + frame * 0.61803398);
					float spread = rough * rough * 0.9;
					int n = rough < 0.08 ? 1 : int(rays);
					vec3 sum = vec3(0.0); float hits = 0.0;
					float bias = max(0.03, g.a * 0.0015);
					for (int i = 0; i < MAX_RAYS; i++) {
						if (i >= n) break;
						float u1 = fract(noise + (float(i) + 0.5) / float(n)), u2 = fract(ign(gl_FragCoord.yx + float(i) * 5.17) + frame * 0.7548776);
						float r = spread * sqrt(u1), phi = 6.2831853 * u2;
						vec3 dir = normalize(R + T * (r * cos(phi)) + B * (r * sin(phi)));
						if (dot(dir, N) <= 0.0) dir = R;
						vec3 start = P + N * bias;
						float jitter = fract(noise * 3.7 + float(i) * 0.31);
						float prev_t = 0.0;
						for (int j = 0; j < STEPS; j++) {
							float s = (float(j) + jitter) / float(STEPS);
							float t = dist * s * s + bias;
							vec3 Q = start + dir * t;
							vec2 uv = toScreen(Q);
							if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || Q.z > -0.01) break;
							vec4 h = texture2D(tGeo, uv);
							if (h.a <= 0.0) { prev_t = t; continue; }
							float behind = -Q.z - h.a;
							if (behind > 0.0 && behind < max(2.0, (t - prev_t) * 1.5)) {
								// a few halvings between the last two steps find the surface
								float a = prev_t, b = t;
								for (int k = 0; k < 4; k++) {
									float mid = (a + b) * 0.5;
									vec3 M = start + dir * mid;
									vec4 hm = texture2D(tGeo, toScreen(M));
									if (hm.a > 0.0 && -M.z - hm.a > 0.0) b = mid; else a = mid;
								}
								vec2 huv = toScreen(start + dir * b);
								// not a surface seen from behind, and faded toward the edges of the screen
								float facing = dot(normalize(texture2D(tGeo, huv).xyz), dir) < 0.2 ? 1.0 : 0.0;
								vec2 edge = smoothstep(0.0, 0.06, huv) * smoothstep(0.0, 0.06, 1.0 - huv);
								float w = facing * edge.x * edge.y * (1.0 - s * s);
								sum += safe3(texture2D(tColor, huv).rgb) * w;
								hits += w;
								break;
							}
							prev_t = t;
						}
					}
					gl_FragColor = vec4(sum / float(n), hits / float(n));
				}`,
			depthTest: false, depthWrite: false,
		});
		this.accumMaterial = new THREE.ShaderMaterial({
			uniforms: {tCurrent: {value: null}, tHistory: {value: null}, weight: {value: 1}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: `uniform sampler2D tCurrent; uniform sampler2D tHistory; uniform float weight; varying vec2 vUv;
				void main() { gl_FragColor = mix(texture2D(tHistory, vUv), texture2D(tCurrent, vUv), weight); }`,
			depthTest: false, depthWrite: false,
		});
		this.compositeMaterial = new THREE.ShaderMaterial({
			uniforms: {tColor: {value: null}, tRefl: {value: null}, tGeo: {value: null}, tMat: {value: null}, proj: {value: new THREE.Matrix4()}, ortho: {value: 0}, strength: {value: 1}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: VIEW_SPACE_GLSL + `
				uniform sampler2D tColor; uniform sampler2D tRefl; uniform sampler2D tGeo; uniform sampler2D tMat; uniform float strength; varying vec2 vUv;
				void main() {
					vec4 src = texture2D(tColor, vUv), refl = texture2D(tRefl, vUv), g = texture2D(tGeo, vUv), m = texture2D(tMat, vUv);
					if (g.a <= 0.0 || refl.a <= 0.0) { gl_FragColor = src; return; }
					vec3 N = normalize(g.xyz), V = ortho > 0.5 ? vec3(0.0, 0.0, -1.0) : normalize(viewPos(vUv, g.a));
					float rough = m.r, metal = m.g, spec = m.b;
					float c = clamp(dot(-V, N), 0.0, 1.0);
					// Schlick's Fresnel; a rough surface reflects less at grazing angles
					vec3 albedo = clamp(src.rgb / max(max(max(src.r, src.g), src.b), 0.2), 0.0, 1.0);
					vec3 F0 = mix(vec3(0.04 * spec * 2.0), albedo, metal);
					vec3 F = F0 + (1.0 - F0) * pow(1.0 - c, 5.0) * (1.0 - rough * 0.85);
					vec3 col = refl.rgb / max(refl.a, 1e-3);
					float k = clamp(refl.a, 0.0, 1.0) * strength * (1.0 - rough * 0.6);
					gl_FragColor = vec4(mix(src.rgb, src.rgb * (1.0 - F * 0.5) + col * F, k), src.a);
				}`,
			depthTest: false, depthWrite: false,
		});
		this.quad = new THREE.FullScreenQuad(null);
	}
	setSize(w, h) {
		this.materials.setSize(w, h); this.trace.setSize(w, h); this.history.forEach(t => t.setSize(w, h)); this.blur.setSize(w, h); this.frames = 0;
	}
	dispose() {
		this.materials.dispose(); this.trace.dispose(); this.history.forEach(t => t.dispose()); this.blur.dispose();
		this.traceMaterial.dispose(); this.accumMaterial.dispose(); this.compositeMaterial.dispose();
		this.material_cache.forEach(m => m.dispose());
	}
	// how rough / metallic / shiny every pixel is (r, g, b), a = something is there
	materialFor(m) {
		const rough = m && m.roughness !== undefined ? m.roughness : 1, metal = m && m.metalness !== undefined ? m.metalness : 0;
		const spec = m && m.clearcoat ? 1 : (m && m.reflectivity !== undefined ? m.reflectivity : 0.5);
		const key = [rough, metal, spec].map(v => Math.round(v * 20)).join('|') + (m && m.side == THREE.DoubleSide ? 'd' : 'f');
		let mat = this.material_cache.get(key);
		if (!mat) {
			mat = new THREE.ShaderMaterial({
				uniforms: {value: {value: new THREE.Vector4(Math.max(0.02, rough), metal, spec, 1)}},
				vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
				fragmentShader: 'uniform vec4 value; void main() { gl_FragColor = value; }',
				side: THREE.DoubleSide, blending: THREE.NoBlending,
			});
			this.material_cache.set(key, mat);
		}
		return mat;
	}
	renderMaterials(renderer, sc, camera) {
		const hidden = hideForPasses(sc), swapped = [];
		sc.traverseVisible(o => {
			if (!o.isMesh || !o.material) return;
			// the shadow catcher floor is only a shadow: what is under it decides
			if ((Array.isArray(o.material) ? o.material : [o.material]).every(m => m && m.isShadowMaterial)) { o.visible = false; hidden.push(o); return; }
			swapped.push([o, o.material]);
			o.material = Array.isArray(o.material) ? o.material.map(m => this.materialFor(m)) : this.materialFor(o.material);
		});
		const background = sc.background, clear = renderer.getClearColor(new THREE.Color()), clear_alpha = renderer.getClearAlpha();
		sc.background = null;
		try {
			renderer.setRenderTarget(this.materials);
			renderer.setClearColor(0x000000, 0);
			renderer.clear();
			renderer.render(sc, camera);
		} finally {
			renderer.setClearColor(clear, clear_alpha);
			sc.background = background;
			swapped.forEach(([o, m]) => { o.material = m; });
			hidden.forEach(o => { o.visible = true; });
		}
	}
	render(renderer, writeBuffer, readBuffer) {
		const s = this.settings, camera = this.camera;
		camera.updateMatrixWorld(true);
		const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		let moved = this.reset;
		for (let i = 0; i < 16 && !moved; i++) if (Math.abs(vp.elements[i] - this.prev.elements[i]) > 1e-6) moved = true;
		this.prev.copy(vp);
		this.reset = false;
		const u = this.traceMaterial.uniforms;
		u.tColor.value = readBuffer.texture;
		u.tGeo.value = this.buffer.target.texture;
		u.tMat.value = this.materials.texture;
		u.proj.value.copy(camera.projectionMatrix);
		u.ortho.value = camera.isOrthographicCamera ? 1 : 0;
		u.rays.value = Math.max(1, Math.min(8, Math.round(s.rays)));
		u.dist.value = s.distance;
		const passes = this.offline ? Math.max(1, Math.min(32, Math.round(s.video_samples || 4))) : 1;
		let next = null;
		for (let pass = 0; pass < passes; pass++) {
			this.frame_index = (this.frame_index + 1) % 4096;
			u.frame.value = this.frame_index;
			renderer.setRenderTarget(this.trace);
			this.quad.material = this.traceMaterial;
			this.quad.render(renderer);
			this.blur.run(renderer, this.trace, this.buffer.target.texture, 1.2);
			this.frames = this.offline ? pass + 1 : s.accumulate && !moved ? Math.min(this.frames + 1, 16) : 1;
			const [hist, nx] = this.history;
			this.accumMaterial.uniforms.tCurrent.value = this.trace.texture;
			this.accumMaterial.uniforms.tHistory.value = hist.texture;
			this.accumMaterial.uniforms.weight.value = 1 / this.frames;
			renderer.setRenderTarget(nx);
			this.quad.material = this.accumMaterial;
			this.quad.render(renderer);
			this.history = [nx, hist];
			next = nx;
		}
		const c = this.compositeMaterial.uniforms;
		c.tColor.value = readBuffer.texture;
		c.tRefl.value = next.texture;
		c.tGeo.value = this.buffer.target.texture;
		c.tMat.value = this.materials.texture;
		c.proj.value.copy(camera.projectionMatrix);
		c.ortho.value = camera.isOrthographicCamera ? 1 : 0;
		c.strength.value = s.strength;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this.quad.material = this.compositeMaterial;
		this.quad.render(renderer);
	}
}

// Volumetric fog: for every pixel the way from the camera to the surface is walked in steps through a fog that thins out with
// height and drifts with the wind (3D noise). At every step the fog is lit by the sky, by the sun (with the sun's shadow map:
// light shafts behind objects) and by the lights (a glow around every lamp, flickering with it).
class VolumetricFogPass extends THREE.Pass {
	constructor(camera, buffer, w, h) {
		super();
		this.camera = camera;
		this.buffer = buffer;
		this.fog = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false});
		this.blur = new BilateralBlur(w, h);
		this.lights = [];
		this.sun = null;
		this.time = 0;
		this.s = null;
		const arr = n => Array.from({length: n}, () => new THREE.Vector3());
		this.marchMaterial = new THREE.ShaderMaterial({
			uniforms: {
				tGeo: {value: null}, proj: {value: new THREE.Matrix4()}, ortho: {value: 0}, camWorld: {value: new THREE.Matrix4()}, camPos: {value: new THREE.Vector3()},
				time: {value: 0}, density: {value: 0.3}, fogColor: {value: new THREE.Color()}, ambient: {value: 0.5}, base: {value: 0}, height: {value: 40},
				noiseAmount: {value: 0.5}, noiseSize: {value: 40}, wind: {value: new THREE.Vector3()}, lightAmount: {value: 1}, aniso: {value: 0.5},
				maxDist: {value: 400}, steps: {value: 32},
				sunDir: {value: new THREE.Vector3(0, 1, 0)}, sunColor: {value: new THREE.Color()}, sunShadowMap: {value: null}, sunShadowMatrix: {value: new THREE.Matrix4()},
				hasShadow: {value: 0}, shadowBias: {value: 0},
				lPos: {value: arr(8)}, lCol: {value: arr(8)}, lRad: {value: new Array(8).fill(1)}, lDir: {value: arr(8)}, lCone: {value: Array.from({length: 8}, () => new THREE.Vector2(-2, -1))}, nLights: {value: 0},
			},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: '#include <packing>\n' + VIEW_SPACE_GLSL + `
				uniform sampler2D tGeo; uniform mat4 camWorld; uniform vec3 camPos; uniform float time; uniform float density; uniform vec3 fogColor;
				uniform float ambient; uniform float base; uniform float height; uniform float noiseAmount; uniform float noiseSize; uniform vec3 wind;
				uniform float lightAmount; uniform float aniso; uniform float maxDist; uniform float steps;
				uniform vec3 sunDir; uniform vec3 sunColor; uniform sampler2D sunShadowMap; uniform mat4 sunShadowMatrix; uniform float hasShadow; uniform float shadowBias;
				uniform vec3 lPos[8]; uniform vec3 lCol[8]; uniform float lRad[8]; uniform vec3 lDir[8]; uniform vec2 lCone[8]; uniform int nLights;
				varying vec2 vUv;
				float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
				float vnoise(vec3 x) {
					vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
					return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
						mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
				}
				float densityAt(vec3 X) {
					float d = density * exp(-max(0.0, X.y - base) / max(height, 0.5));
					if (noiseAmount > 0.0) {
						vec3 q = (X - wind * time) / max(noiseSize, 1.0);
						float n = vnoise(q) * 0.55 + vnoise(q * 2.03 + 11.7) * 0.3 + vnoise(q * 4.11 + 3.1) * 0.15;
						d *= mix(1.0, smoothstep(0.25, 0.75, n) * 2.0, noiseAmount);
					}
					return d;
				}
				float phase(float c) { float g = aniso; return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5); }
				float sunVisible(vec3 X) {
					if (hasShadow < 0.5) return 1.0;
					vec4 sc = sunShadowMatrix * vec4(X, 1.0);
					sc.xyz /= sc.w;
					if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
					return step(sc.z + shadowBias - 0.004, unpackRGBAToDepth(texture2D(sunShadowMap, sc.xy)));
				}
				void main() {
					vec4 g = texture2D(tGeo, vUv);
					vec3 Pv = viewPos(vUv, g.a > 0.0 ? g.a : maxDist);
					vec3 Pw = (camWorld * vec4(Pv, 1.0)).xyz;
					vec3 O = ortho > 0.5 ? (camWorld * vec4(Pv.xy, 0.0, 1.0)).xyz : camPos;
					vec3 rd = normalize(Pw - O);
					float L = min(length(Pw - O), maxDist);
					float stepLen = L / steps;
					float jitter = ign(gl_FragCoord.xy);
					float sunPhase = phase(dot(rd, sunDir));
					float T = 1.0; vec3 scat = vec3(0.0);
					for (int i = 0; i < 128; i++) {
						if (float(i) >= steps) break;
						vec3 X = O + rd * ((float(i) + jitter) * stepLen);
						float d = densityAt(X);
						if (d < 1e-5) continue;
						vec3 light = vec3(ambient) + sunColor * (lightAmount * sunPhase * sunVisible(X));
						for (int k = 0; k < 8; k++) {
							if (k >= nLights) break;
							vec3 dl = lPos[k] - X;
							float dist = length(dl);
							float a = clamp(1.0 - dist / lRad[k], 0.0, 1.0);
							// a spot (or a rectangle of light) only lights the fog in front of it
							float cone = lCone[k].x < -1.5 ? 1.0 : smoothstep(lCone[k].x, max(lCone[k].y, lCone[k].x + 1e-3), dot(-dl / max(dist, 1e-3), lDir[k]));
							light += lCol[k] * (lightAmount * a * a * cone * phase(dot(rd, dl / max(dist, 1e-3))));
						}
						float tr = exp(-d * 0.01 * stepLen);
						scat += T * fogColor * light * (1.0 - tr);
						T *= tr;
						if (T < 0.003) break;
					}
					gl_FragColor = vec4(scat, T);
				}`,
			depthTest: false, depthWrite: false,
		});
		this.compositeMaterial = new THREE.ShaderMaterial({
			uniforms: {tColor: {value: null}, tFog: {value: null}},
			vertexShader: FULLSCREEN_VERTEX,
			fragmentShader: `uniform sampler2D tColor; uniform sampler2D tFog; varying vec2 vUv;
				void main() { vec4 src = texture2D(tColor, vUv); vec4 f = texture2D(tFog, vUv); gl_FragColor = vec4(src.rgb * f.a + f.rgb, src.a); }`,
			depthTest: false, depthWrite: false,
		});
		this.quad = new THREE.FullScreenQuad(null);
	}
	setSize(w, h) { this.fog.setSize(w, h); this.blur.setSize(w, h); }
	dispose() { this.fog.dispose(); this.blur.dispose(); this.marchMaterial.dispose(); this.compositeMaterial.dispose(); }
	render(renderer, writeBuffer, readBuffer) {
		const s = this.s, camera = this.camera, u = this.marchMaterial.uniforms;
		if (!s) { this.needsSwap = false; return; }
		this.needsSwap = true;
		camera.updateMatrixWorld(true);
		u.tGeo.value = this.buffer.target.texture;
		u.proj.value.copy(camera.projectionMatrix);
		u.ortho.value = camera.isOrthographicCamera ? 1 : 0;
		u.camWorld.value.copy(camera.matrixWorld);
		u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
		u.time.value = this.time;
		u.density.value = s.fog_density;
		u.fogColor.value.set(s.fog_color).convertSRGBToLinear();
		u.ambient.value = s.fog_brightness;
		u.base.value = s.fog_base;
		u.height.value = s.fog_height;
		u.noiseAmount.value = s.fog_noise;
		u.noiseSize.value = s.fog_noise_size;
		const wa = s.fog_wind_dir * Math.PI / 180;
		u.wind.value.set(Math.sin(wa), 0, Math.cos(wa)).multiplyScalar(s.fog_wind);
		u.lightAmount.value = s.fog_light;
		u.aniso.value = Math.max(-0.9, Math.min(0.9, s.fog_anisotropy));
		u.maxDist.value = Math.min(s.fog_distance, camera.far || s.fog_distance);
		u.steps.value = Math.max(8, Math.min(128, Math.round(s.fog_quality)));
		const sun = this.sun;
		if (sun) {
			u.sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
			u.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
			const map = sun.shadow && sun.shadow.map;
			const shadowed = !!(s.fog_shafts && sun.castShadow && map && map.texture);
			u.hasShadow.value = shadowed ? 1 : 0;
			if (shadowed) { u.sunShadowMap.value = map.texture; u.sunShadowMatrix.value.copy(sun.shadow.matrix); u.shadowBias.value = sun.shadow.bias; }
		} else u.sunColor.value.setRGB(0, 0, 0);
		const n = Math.min(8, this.lights.length);
		for (let i = 0; i < n; i++) {
			const l = this.lights[i];
			u.lPos.value[i].copy(l.position);
			u.lCol.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
			u.lRad.value[i] = Math.max(1, l.userData.radius || l.distance || 1);
			u.lDir.value[i].copy(l.userData.forward || new THREE.Vector3(0, 0, -1));
			const cone = l.userData.cone;
			u.lCone.value[i].set(cone ? cone[0] : -2, cone ? cone[1] : -1);
		}
		u.nLights.value = n;
		renderer.setRenderTarget(this.fog);
		this.quad.material = this.marchMaterial;
		this.quad.render(renderer);
		this.blur.run(renderer, this.fog, this.buffer.target.texture, 1);
		const c = this.compositeMaterial.uniforms;
		c.tColor.value = readBuffer.texture;
		c.tFog.value = this.fog.texture;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this.quad.material = this.compositeMaterial;
		this.quad.render(renderer);
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
			col = clamp(col, vec3(0.0), vec3(5000.0));   // one broken (infinite) pixel must not turn into a black square
			if (!(col.r > -1.0 && col.g > -1.0 && col.b > -1.0)) col = vec3(0.0);
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

// The picture is kept in 16 bit floats: anything brighter than 65000 becomes "infinity", and infinity next to a normal pixel
// turns into "not a number" in every blur (bloom, motion blur): a black square. A shiny surface in the sun can reach that, so no
// material may write more than this (nobody sees the difference: the picture is squeezed to 0..1 at the end anyway).
const BRIGHTEST = 'gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(3000.0));';
let chunk_original = null;
function limitBrightness(on) {
	const chunks = THREE.ShaderChunk;
	if (on && chunk_original === null) {
		chunk_original = chunks.tonemapping_fragment;
		chunks.tonemapping_fragment = chunk_original + '\n' + BRIGHTEST + '\n';
	} else if (!on && chunk_original !== null) {
		chunks.tonemapping_fragment = chunk_original;
		chunk_original = null;
	}
}
limitBrightness(true);

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

	if (s.rt || s.fog || s.gloss) p.gbuf = new SceneBuffer(renderer, w, h);
	if (s.rt) {
		p.rt = new RayTracePass(camera, p.gbuf, w, h);
		composer.addPass(p.rt);
	}

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
	if (s.gloss) {
		p.gloss = new GlossyReflectionPass(camera, p.gbuf, w, h);
		composer.addPass(p.gloss);
	}
	if (s.fog) {
		p.fog = new VolumetricFogPass(camera, p.gbuf, w, h);
		composer.addPass(p.fog);
	}
	if (motionAmount() > 0) {
		p.mb = new MotionBlurPass(scene, camera, w, h);
		composer.addPass(p.mb);
	}
	if (bloomAmount() > 0) {
		p.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), bloomAmount() * 0.35, s.bloom_radius, s.bloom_threshold);
		composer.addPass(p.bloom);
	}
	if (s.dof || wantsFocus(activeCameraData())) {
	p.dof = new THREE.BokehPass(scene, camera, {focus: s.dof_focus, aperture: 0.00002, maxblur: 0.01, width: w, height: h});
		const bokeh_render = p.dof.render.bind(p.dof);
		p.dof.render = (...args) => {   // the sky must not end up in the depth picture
			const background = scene.background, hidden = hideForPasses(scene);
			scene.background = null;
			try { bokeh_render(...args); } finally { scene.background = background; hidden.forEach(o => { o.visible = true; }); }
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
	if (p.gbuf) p.gbuf.dispose();
	p.composer.renderTarget1.dispose();
	p.composer.renderTarget2.dispose();
}

function structureKey(preview) {
	const s = settingsOf();
	return [preview.camera.uuid, s.rt, s.fog, s.gloss, s.ao, s.ssr, motionAmount() > 0, bloomAmount() > 0, s.dof || wantsFocus(activeCameraData()), s.fxaa].join('|');
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
		if (p.gbuf) p.gbuf.setSize(size.x, size.y);
	}
	const s = settingsOf();
	if (p.rt) {
		Object.assign(p.rt.settings, {rays: s.rt_rays, distance: s.rt_distance, bounce: s.rt_bounce, ao: s.rt_ao, shadows: s.shadows ? s.rt_shadows : 0, accumulate: s.rt_accumulate, video_samples: s.rt_video_samples});
		p.rt.offline = !!preview.offline;
		if (rig) p.rt.sun_dir.copy(rig.sun.position).sub(rig.sun.target.position).normalize();
		// something moved (animation, physics, editing) or the settings changed: start adding up again
		const stamp = sceneSignature() + '|' + JSON.stringify(Project.render_settings || {});
		if (stamp !== p.rt_stamp) p.rt.reset = true;
		p.rt_stamp = stamp;
	}
	if (p.gloss) {
		Object.assign(p.gloss.settings, {strength: s.gloss_strength, distance: s.gloss_distance, rays: s.gloss_rays, accumulate: s.rt_accumulate, video_samples: Math.max(2, Math.round(s.rt_video_samples / 2))});
		p.gloss.offline = !!preview.offline;
		const stamp = sceneSignature() + '|' + JSON.stringify(Project.render_settings || {});
		if (stamp !== p.gloss_stamp) p.gloss.reset = true;
		p.gloss_stamp = stamp;
	}
	if (p.fog) {
		p.fog.s = s;
		p.fog.time = lightClock();
		p.fog.sun = rig ? rig.sun : null;
		p.fog.lights = rig ? [...rig.lights.values()].filter(l => l.visible !== false && l.intensity > 0) : [];
	}
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
	if (p.mb) { p.mb.amount = motionAmount(); p.mb.max_gap = preview.offline ? Infinity : 250; }
	if (p.bloom) { p.bloom.strength = bloomAmount() * 0.35; p.bloom.threshold = s.bloom_threshold; p.bloom.radius = s.bloom_radius; }
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

// a number that changes whenever anything in the scene moves or changes shape (or a light changes)
function sceneSignature() {
	let sig = 0, i = 1;
	for (const el of [...Cube.all, ...Mesh.all]) {
		const m = el.mesh;
		if (!m) continue;
		const e = m.matrixWorld.elements, pos = m.geometry && m.geometry.attributes.position;
		sig += (e[0] * 1.3 + e[5] * 1.7 + e[10] * 2.3 + e[1] * 0.7 + e[12] * 0.11 + e[13] * 0.13 + e[14] * 0.17 + (pos ? pos.version : 0) + (m.visible ? 0 : 5)) * (1 + (i++ % 97) * 0.01);
	}
	if (rig) rig.lights.forEach(l => { sig += l.intensity * 3.1 + l.position.x * 0.19 + l.position.y * 0.23 + l.position.z * 0.29; });
	return sig.toFixed(5);
}

// the ripples of water and glass move with the time of the animation (the same in a video every time)
function animateWaves() {
	const t = lightClock();
	for (const c of material_cache.values()) {
		const list = Array.isArray(c.material) ? c.material : [c.material];
		for (const m of list) {
			const speed = m && m.userData && m.userData.wave_speed;
			if (!speed || !m.normalMap) continue;
			m.normalMap.offset.set((t * speed * 0.05) % 1, (t * speed * 0.031) % 1);
		}
	}
}

const original_render = Preview.prototype.render;
function renderWithEffects() {
syncActiveCamera(this);
if (Project) { updateParticles(this.camera); syncDecals(); }
if (!enabled || !Project) return original_render.call(this);
	try {
		this.controls.update();
		applyMaterials();
		animateWaves();
		if (!rig) {
		disposeRig();
		rig = buildRig(this.renderer);
			scene.add(rig.group);
		}
		updateRig(this.renderer);
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
		if (pipe.gbuf) pipe.gbuf.render(r, scene, camera);
		if (pipe.gloss) pipe.gloss.renderMaterials(r, scene, camera);
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

const DEFAULT_LIGHT = {kind: 'point', color: '#ffe0b0', strength: 3, radius: 96, shadows: false, flicker: 'none', flicker_amount: 0.5, flicker_speed: 1, angle: 30, softness: 0.4, area_w: 16, area_h: 16};
const DEFAULT_CAMERA = {bloom: 0.35, motion_blur: 0.5, fov: 50, distortion: 0, chroma: 0, vignette: 0.3, grain: 0, saturation: 1, contrast: 1, temperature: 0, focus: '', focus_blur: 0.6};
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
// how strong the glow is: a camera we look through sets its own, otherwise the Render panel does
const bloomAmount = () => { const cam = activeCameraData(); return Math.max(0, cam ? cam.bloom : (settingsOf().bloom ? settingsOf().bloom_strength : 0)); };
const motionAmount = () => { const cam = activeCameraData(); return Math.max(0, cam ? cam.motion_blur : settingsOf().motion_blur); };
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
	} else if (kind == 'particles') {
		c.fillStyle = '#7ee0c0';
		for (const [x, y, r] of [[64, 40, 12], [42, 62, 9], [84, 66, 10], [58, 86, 7], [80, 92, 5], [36, 88, 5], [92, 40, 6]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
		c.strokeStyle = '#7ee0c0'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
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
	// an empty group that gives off particles gets an icon too (otherwise it could not be clicked in the viewport)
	const kindOf = g => isLight(g) ? 'light' : isCamera(g) ? 'camera' : 'particles';
	const emitting = Group.all.filter(g => hasParticles(g) && !isLight(g) && !isCamera(g) && !g.children.length);
	const groups = [...lightGroups(), ...cameraGroups(), ...emitting].filter(g => g.mesh);
	for (const uuid of [...editor_helpers.keys()]) {
		const g = groups.find(x => x.uuid == uuid);
		if (!g || editor_helpers.get(uuid).kind != kindOf(g)) removeEditorHelper(uuid);
	}
	const preview = typeof Preview != 'undefined' && Preview.selected, cam = preview && preview.camera;
	const active = activeCameraGroup();
	for (const g of groups) {
		const kind = kindOf(g);
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
			} else if (kind == 'camera') {
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
			h.wire.visible = !!g.selected && d.kind != 'area';
			h.wire.scale.setScalar(Math.max(0.01, d.radius));
			h.wire.material.color.set(d.color);
			// a spot shows its cone, a rectangle of light its frame; both turn with the group (they shine along its -Z)
			const shape_key = d.kind + '|' + d.angle + '|' + d.radius + '|' + d.area_w + '|' + d.area_h;
			if (h.shape_key != shape_key) {
				if (h.shape) { h.object.remove(h.shape); h.shape.geometry.dispose(); h.shape.material.dispose(); h.shape = null; }
				const pts = [];
				if (d.kind == 'spot') {
					const L = Math.min(d.radius, 48), r = Math.tan(Math.max(1, Math.min(89, d.angle)) * Math.PI / 180) * L;
					for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; pts.push(0, 0, 0, Math.cos(a) * r, Math.sin(a) * r, -L); }
					for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, b = (i + 1) / 24 * Math.PI * 2; pts.push(Math.cos(a) * r, Math.sin(a) * r, -L, Math.cos(b) * r, Math.sin(b) * r, -L); }
				} else if (d.kind == 'area') {
					const w = d.area_w / 2, hh = d.area_h / 2;
					pts.push(-w, -hh, 0, w, -hh, 0, w, -hh, 0, w, hh, 0, w, hh, 0, -w, hh, 0, -w, hh, 0, -w, -hh, 0, 0, 0, 0, 0, 0, -Math.max(4, Math.min(w, hh)));
				}
				if (pts.length) {
					const geo = new THREE.BufferGeometry();
					geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
					h.shape = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({transparent: true, opacity: 0.8, depthTest: false}));
					h.shape.renderOrder = 998;
					h.object.add(h.shape);
				}
				h.shape_key = shape_key;
			}
			if (h.shape) {
				h.shape.quaternion.copy(g.mesh.getWorldQuaternion(new THREE.Quaternion()));
				h.shape.material.color.set(g.selected ? '#ffffff' : d.color);
				h.shape.visible = !!g.selected || d.kind == 'area';
			}
		} else if (kind == 'camera') {
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

// --- flickering lights: how bright a light is at a moment (1 = as set) ---------------------------
// The moment is the animation's time in the Animate tab and in a video (so it flickers the same every time it plays),
// the clock everywhere else.
let video_clock = null;
const lightClock = () => video_clock !== null ? video_clock
	: (typeof Modes != 'undefined' && Modes.animate && typeof Animation != 'undefined' && Animation.selected && typeof Timeline != 'undefined') ? Timeline.time
	: performance.now() / 1000;
const lhash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// smooth value noise, 0..1
const lnoise = t => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lhash(i) * (1 - u) + lhash(i + 1) * u; };
function flickerOf(d, t, seed) {
	const a = Math.max(0, Math.min(1, d.flicker_amount ?? 0.5)), k = Math.max(0.05, d.flicker_speed ?? 1);
	const T = t * k + seed * 17.3;
	switch (d.flicker) {
		case 'candle': {
			// a flame: a slow sway and a quicker unsteady flutter
			const n = lnoise(T * 3) * 0.55 + lnoise(T * 9 + 5) * 0.3 + lnoise(T * 23 + 9) * 0.15;
			return 1 - a * n;
		}
		case 'fire': {
			const n = lnoise(T * 6) * 0.5 + lnoise(T * 15 + 3) * 0.3 + lnoise(T * 41 + 7) * 0.2;
			return Math.max(0, 1 - a * 1.3 * n + a * 0.25 * lnoise(T * 2));
		}
		case 'fluorescent': {
			// a failing tube: mostly on, now and then it stutters off for a moment, and it hums
			const slot = Math.floor(T * 12), stutter = lhash(slot + 0.5) < 0.12 * a + 0.02 ? 0.1 + 0.4 * lhash(slot + 3.1) : 1;
			const burst = lhash(Math.floor(T * 0.7) + 7.7) < 0.25 * a ? (Math.sin(T * 90) > 0 ? 1 : 0.15) : 1;
			return Math.min(stutter, burst) * (1 - 0.04 * a * Math.sin(T * 314));
		}
		case 'broken': {
			// a loose contact: goes off and comes back at random
			const slot = Math.floor(T * 6);
			return lhash(slot + 0.25) < 0.45 * a ? 0.05 : 1;
		}
		case 'strobe': return (T * 2) % 1 < 0.5 ? 1 : 1 - a;
		case 'pulse': return 1 - a * (0.5 - 0.5 * Math.cos(T * Math.PI * 2 * 0.5));
		default: return 1;
	}
}

const FLICKER_OPTIONS = () => ({none: tr('fl_none'), candle: tr('fl_candle'), fire: tr('fl_fire'), fluorescent: tr('fl_fluorescent'), broken: tr('fl_broken'), strobe: tr('fl_strobe'), pulse: tr('fl_pulse')});

let area_ready = false;
// a light of the kind it should be (a point, a spot looking along the group's -Z, or a glowing rectangle facing -Z)
function lightObject(d) {
	if (d.kind == 'spot') { const l = new THREE.SpotLight(0xffffff, 1, 100, 0.5, 0.4, 2); l.userData.kind = 'spot'; return l; }
	if (d.kind == 'area') {
		if (!area_ready && THREE.RectAreaLightUniformsLib) { THREE.RectAreaLightUniformsLib.init(); area_ready = true; }
		const l = new THREE.RectAreaLight(0xffffff, 1, 16, 16); l.userData.kind = 'area'; return l;
	}
	const l = new THREE.PointLight(0xffffff, 1, 100, 2); l.userData.kind = 'point'; return l;
}
function syncLights() {
	const list = lightGroups().filter(g => g.mesh && g.visibility !== false);
	const seen = new Set();
	let shadows = 0;
	for (const g of list) {
		const d = lightOf(g), kind = ['spot', 'area'].includes(d.kind) ? d.kind : 'point';
		let light = rig.lights.get(g.uuid);
		if (light && light.userData.kind != kind) {
			rig.group.remove(light);
			if (light.target && light.target.parent) light.target.parent.remove(light.target);
			if (light.dispose) light.dispose();
			light = null;
		}
		if (!light) {
			light = lightObject({kind});
			rig.group.add(light);
			if (light.target) rig.group.add(light.target);
			rig.lights.set(g.uuid, light);
		}
		g.mesh.updateMatrixWorld(true);
		const pos = g.mesh.getWorldPosition(new THREE.Vector3()), quat = g.mesh.getWorldQuaternion(new THREE.Quaternion());
		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
		light.position.copy(pos);
		light.color.set(d.color);
		const flick = d.flicker && d.flicker != 'none' ? flickerOf(d, lightClock(), lhash(g.uuid.length + g.uuid.charCodeAt(0) * 0.37 + g.uuid.charCodeAt(2) * 0.11)) : 1;
		light.userData.radius = Math.max(1, d.radius);
		light.userData.forward = forward.clone();
		if (kind == 'area') {
			// a rectangle of light: its brightness is per area, so a bigger one shines more
			light.intensity = d.strength * flick * 0.6;
			light.width = Math.max(0.1, d.area_w);
			light.height = Math.max(0.1, d.area_h);
			light.quaternion.copy(quat);
			light.userData.cone = [0, 0.35];   // (for the fog: it shines to its front)
		} else {
			light.intensity = d.strength * flick;
			light.distance = Math.max(1, d.radius);
			if (kind == 'spot') {
				const angle = Math.max(1, Math.min(89, d.angle)) * Math.PI / 180;
				light.angle = angle;
				light.penumbra = Math.max(0, Math.min(1, d.softness));
				light.target.position.copy(pos).addScaledVector(forward, 10);
				light.target.updateMatrixWorld(true);
				light.userData.cone = [Math.cos(angle), Math.cos(angle * (1 - light.penumbra))];
			} else light.userData.cone = null;
			const cast = !!d.shadows && shadows < 3;
			if (cast) shadows++;
			if (light.castShadow != cast) {
				light.castShadow = cast;
				light.shadow.mapSize.set(1024, 1024);
				light.shadow.bias = -0.001;
				light.shadow.normalBias = 0.05;
				light.shadow.camera.near = 0.5;
			}
		}
		seen.add(g.uuid);
	}
	for (const [uuid, light] of rig.lights) {
		if (seen.has(uuid)) continue;
		rig.group.remove(light);
		if (light.target && light.target.parent) light.target.parent.remove(light.target);
		if (light.dispose) light.dispose();
		rig.lights.delete(uuid);
	}
}

// ---------------------------------------------------------------------------
// Particles: any cube, mesh or group can give off particles (smoke, sparks, snow, dust...). The settings live on the object
// (saved in the project); the Particles panel on the right edits the selected one.
// Every particle is worked out from the time alone (when it was born, where the object was then, its own random numbers),
// so the same moment of an animation always looks the same: scrubbing the timeline and a video give the very same picture.
// ---------------------------------------------------------------------------

const DEFAULT_PARTICLES = {
	enabled: true, count: 150, lifetime: 2, life_jitter: 0.3, fade_in: 0.2, fade_out: 0.8, prewarm: true,
	texture: 'smoke', image: '', image_name: '',
	direction: 'up', yaw: 0, pitch: 45, local: false, spread: 20, speed: 25, speed_jitter: 0.3, gravity: 0, drag: 0.3,
	shape: 'point', follow: false,
	size: 4, size_end: 12, size_jitter: 0.3, spin: 0.5, color: '#ffffff', color_end: '#9a9a9a', opacity: 0.8, glow: 0, additive: false,
	collide: false, bounce: 0.3, friction: 0.4, stick: false,
	sheet_cols: 1, sheet_rows: 1, sheet_mode: 'life', sheet_fps: 12,
};
const PARTICLE_TEXTURES = ['dot', 'smoke', 'spark', 'fire', 'snow', 'drop', 'star', 'square'];
const particlesOf = node => Object.assign({}, DEFAULT_PARTICLES, node.render_particles || {});
const hasParticles = node => !!node && hasData(node.render_particles);
const particleNodes = () => [...Cube.all, ...Mesh.all, ...Group.all].filter(hasParticles);

// the built in particle pictures (white, coloured by the particle colour)
const particle_textures = new Map();
function builtinParticleTexture(kind) {
	if (particle_textures.has(kind)) return particle_textures.get(kind);
	const S = 128, canvas = document.createElement('canvas');
	canvas.width = canvas.height = S;
	const c = canvas.getContext('2d');
	const radial = (x, y, r, stops) => { const g = c.createRadialGradient(x, y, 0, x, y, r); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
	let seed = 7;
	const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	c.fillStyle = '#fff'; c.strokeStyle = '#fff';
	if (kind == 'dot') {
		c.fillStyle = radial(64, 64, 62, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
		c.fillRect(0, 0, S, S);
	} else if (kind == 'smoke') {
		for (let i = 0; i < 16; i++) {
			const a = rnd() * Math.PI * 2, d = rnd() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 22 + rnd() * 18;
			c.fillStyle = radial(x, y, r, [[0, 'rgba(255,255,255,0.32)'], [1, 'rgba(255,255,255,0)']]);
			c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
		}
	} else if (kind == 'spark') {
		c.fillStyle = radial(64, 64, 20, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
		c.fillRect(0, 0, S, S);
		c.lineCap = 'round';
		for (const [w, a] of [[5, 0.9], [2.5, 0.5]]) {
			c.globalAlpha = a; c.lineWidth = w;
			c.beginPath(); c.moveTo(64, 6); c.lineTo(64, 122); c.moveTo(6, 64); c.lineTo(122, 64); c.stroke();
		}
		c.globalAlpha = 1;
	} else if (kind == 'fire') {
		c.save(); c.translate(64, 70); c.scale(1, 1.5);
		c.fillStyle = radial(0, 0, 40, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
		c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 2); c.fill();
		c.restore();
	} else if (kind == 'snow') {
		c.lineCap = 'round'; c.lineWidth = 6;
		for (let i = 0; i < 6; i++) {
			const a = i * Math.PI / 3, x = 64 + Math.cos(a) * 52, y = 64 + Math.sin(a) * 52;
			c.beginPath(); c.moveTo(64, 64); c.lineTo(x, y); c.stroke();
			for (const f of [0.55, 0.8]) {
				const bx = 64 + Math.cos(a) * 52 * f, by = 64 + Math.sin(a) * 52 * f;
				for (const s of [-1, 1]) { c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a + s * 0.8) * 14, by + Math.sin(a + s * 0.8) * 14); c.stroke(); }
			}
		}
	} else if (kind == 'drop') {
		c.fillStyle = radial(64, 80, 38, [[0, 'rgba(255,255,255,1)'], [0.8, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]);
		c.beginPath(); c.moveTo(64, 8); c.bezierCurveTo(70, 40, 100, 58, 100, 82); c.arc(64, 82, 36, 0, Math.PI); c.bezierCurveTo(28, 58, 58, 40, 64, 8); c.fill();
	} else if (kind == 'star') {
		c.beginPath();
		for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 58, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
		c.closePath(); c.fill();
	} else {
		c.fillRect(8, 8, 112, 112);
	}
	const t = new THREE.CanvasTexture(canvas);
	particle_textures.set(kind, t);
	return t;
}
// a picture of the project, or one loaded from a file
function particleTexture(d) {
	if (d.texture == 'image' && d.image) {
		const key = 'pimg:' + d.image.length + d.image.slice(-48);
		if (!particle_textures.has(key)) particle_textures.set(key, new THREE.TextureLoader().load(d.image));
		return particle_textures.get(key);
	}
	if (d.texture && d.texture.startsWith('tex:')) {
		const t = textureFor({kind: 'texture', uuid: d.texture.slice(4)}, false);
		if (t) return t;
	}
	return builtinParticleTexture(PARTICLE_TEXTURES.includes(d.texture) ? d.texture : 'dot');
}

const ParticleShader = {
	vertexShader: `
		attribute vec3 iPos; attribute vec4 iColor; attribute vec3 iSizeRot;
		uniform float linearOut; uniform vec2 sheet; varying vec2 vUv; varying vec4 vColor;
		void main() {
			// a frame of a sprite sheet: counted from the top left, row by row
			float f = iSizeRot.z, cx = mod(f, sheet.x), cy = floor(f / sheet.x);
			vUv = vec2((uv.x + cx) / sheet.x, (uv.y + sheet.y - 1.0 - cy) / sheet.y);
			vColor = iColor;
			if (linearOut > 0.5) vColor.rgb = pow(vColor.rgb, vec3(2.2));
			vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
			float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
			mv.xy += mat2(c, s, -s, c) * position.xy * iSizeRot.x;
			gl_Position = projectionMatrix * mv;
		}`,
	fragmentShader: `
		uniform sampler2D map; uniform float glow; uniform float additive; uniform float linearOut; varying vec2 vUv; varying vec4 vColor;
		void main() {
			vec4 t = texture2D(map, vUv);
			if (linearOut > 0.5) t.rgb = pow(t.rgb, vec3(2.2));
			float a = t.a * vColor.a;
			if (a < 0.003) discard;
			vec3 col = t.rgb * vColor.rgb * (1.0 + glow);
			gl_FragColor = additive > 0.5 ? vec4(col * a, 1.0) : vec4(col, a);
		}`,
};

// a small random number of particle k of an emitter (always the same for the same k)
function prand(seed, k, i) {
	let h = Math.imul(k | 0, 374761393) ^ Math.imul(i + 1, 668265263) ^ Math.imul(seed | 0, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

const emitters = new Map();   // node uuid -> state
function emitterFor(node) {
	let e = emitters.get(node.uuid);
	if (e) return e;
	const geometry = new THREE.InstancedBufferGeometry();
	const quad = new THREE.PlaneGeometry(1, 1);
	geometry.index = quad.index;
	geometry.setAttribute('position', quad.attributes.position);
	geometry.setAttribute('uv', quad.attributes.uv);
	const material = new THREE.ShaderMaterial({
		uniforms: {map: {value: null}, glow: {value: 0}, additive: {value: 0}, linearOut: {value: 0}, sheet: {value: new THREE.Vector2(1, 1)}},
		vertexShader: ParticleShader.vertexShader, fragmentShader: ParticleShader.fragmentShader,
		transparent: true, depthWrite: false, side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = 10;
	mesh.userData.render_no_fx = true;
	mesh.name = 'render_particles';
	scene.add(mesh);
	let seed = 0;
	for (let i = 0; i < node.uuid.length; i++) seed = Math.imul(seed ^ node.uuid.charCodeAt(i), 16777619);
	e = {mesh, geometry, material, capacity: 0, history: [], seed, epoch: null, last_t: null};
	emitters.set(node.uuid, e);
	return e;
}
function removeEmitter(uuid) {
	const e = emitters.get(uuid);
	if (!e) return;
	scene.remove(e.mesh);
	e.geometry.dispose();
	e.material.dispose();
	emitters.delete(uuid);
}
function clearEmitters() { [...emitters.keys()].forEach(removeEmitter); }

function ensureCapacity(e, n) {
	if (n <= e.capacity) return;
	const cap = Math.ceil(n * 1.25 + 16);
	e.pos = new Float32Array(cap * 3); e.col = new Float32Array(cap * 4); e.sr = new Float32Array(cap * 3);
	e.geometry.setAttribute('iPos', new THREE.InstancedBufferAttribute(e.pos, 3).setUsage(THREE.DynamicDrawUsage));
	e.geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(e.col, 4).setUsage(THREE.DynamicDrawUsage));
	e.geometry.setAttribute('iSizeRot', new THREE.InstancedBufferAttribute(e.sr, 3).setUsage(THREE.DynamicDrawUsage));
	e.capacity = cap;
}

// where the object is (and how it is turned) at a time: from what was seen while the time ran
function poseAt(e, t) {
	const h = e.history;
	if (!h.length) return null;
	if (t <= h[0].t) return h[0];
	if (t >= h[h.length - 1].t) return h[h.length - 1];
	let lo = 0, hi = h.length - 1;
	while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (h[mid].t <= t) lo = mid; else hi = mid; }
	const a = h[lo], b = h[hi], f = (t - a.t) / Math.max(1e-6, b.t - a.t);
	return {t, p: a.p.clone().lerp(b.p, f), q: a.q.clone().slerp(b.q, f), size: a.size};
}

const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _c0 = new THREE.Color(), _c1 = new THREE.Color();
function baseDirection(d, r1, r2, out) {
	switch (d.direction) {
		case 'down': return out.set(0, -1, 0);
		case 'sideways': { const a = r1 * Math.PI * 2; return out.set(Math.cos(a), 0, Math.sin(a)); }
		case 'all': { const z = r1 * 2 - 1, a = r2 * Math.PI * 2, r = Math.sqrt(1 - z * z); return out.set(r * Math.cos(a), z, r * Math.sin(a)); }
		case 'custom': {
			const yaw = d.yaw * Math.PI / 180, pitch = d.pitch * Math.PI / 180;
			return out.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
		}
		default: return out.set(0, 1, 0);
	}
}
// a direction turned away from "dir" by up to "spread" degrees, evenly over the cone
function spreadDirection(dir, spread, r1, r2, out) {
	const cosMax = Math.cos(Math.min(180, Math.max(0, spread)) * Math.PI / 180);
	const z = 1 - r1 * (1 - cosMax), a = r2 * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z));
	const t = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0).cross(dir).normalize() : new THREE.Vector3(1, 0, 0).cross(dir).normalize();
	const b = dir.clone().cross(t);
	return out.copy(dir).multiplyScalar(z).addScaledVector(t, r * Math.cos(a)).addScaledVector(b, r * Math.sin(a)).normalize();
}

function updateEmitter(node, e, t, camera) {
	const d = particlesOf(node);
	const mesh = node.mesh;
	const visible = d.enabled && mesh && node.visibility !== false && d.count > 0;
	e.mesh.visible = !!visible;
	if (!visible) return;
	// the object now
	mesh.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(mesh);
	const p = box.isEmpty() ? mesh.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
	if (node instanceof Group && !node.children.some(c => c.mesh)) mesh.getWorldPosition(p);
	const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
	const q = mesh.getWorldQuaternion(new THREE.Quaternion());
	const life = Math.max(0.05, d.lifetime), max_life = life * (1 + Math.max(0, d.life_jitter));
	// the history of where it was (a step back in time forgets what came after)
	if (e.last_t !== null && t < e.last_t - 1e-6) e.history = e.history.filter(h => h.t <= t);
	const last = e.history[e.history.length - 1];
	if (!last || t > last.t + 1e-6) e.history.push({t, p, q, size});
	else if (Math.abs(t - last.t) <= 1e-6) Object.assign(last, {p, q, size});
	while (e.history.length > 2 && e.history[1].t < t - max_life - 0.5) e.history.shift();
	if (e.history.length > 4000) e.history.splice(0, e.history.length - 4000);
	// a new start: when it was switched on, or the time jumped back before it
	const anim = lightClockIsAnimation();
	if (e.epoch === null || e.last_t === null || t < e.epoch) e.epoch = anim ? 0 : t;
	e.last_t = t;
	const start = d.prewarm ? -Infinity : e.epoch;

	const rate = d.count / life;
	const k0 = Math.max(Math.ceil((t - max_life) * rate), start === -Infinity ? -Infinity : Math.ceil(start * rate));
	const k1 = Math.floor(t * rate);
	ensureCapacity(e, Math.max(0, k1 - k0 + 1));
	_c0.set(d.color); _c1.set(d.color_end);
	const g = -d.gravity, drag = Math.max(0, d.drag);
	const list = [];
	for (let k = k0; k <= k1; k++) {
		const born = k / rate, r = i => prand(e.seed, k, i);
		const L = life * (1 + d.life_jitter * (r(0) * 2 - 1));
		const age = t - born;
		if (age < 0 || age >= L) continue;
		const pose = d.follow ? {p, q, size} : (poseAt(e, born) || {p, q, size});
		// where it starts
		const pos = new THREE.Vector3();
		if (d.shape == 'box') pos.set((r(1) - 0.5) * pose.size.x, (r(2) - 0.5) * pose.size.y, (r(3) - 0.5) * pose.size.z);
		pos.add(pose.p);
		// which way and how fast
		baseDirection(d, r(4), r(5), _dir);
		if (d.local) _dir.applyQuaternion(pose.q);
		spreadDirection(_dir.normalize(), d.direction == 'all' || d.direction == 'sideways' ? Math.min(d.spread, 90) : d.spread, r(6), r(7), _v);
		const speed = d.speed * (1 + d.speed_jitter * (r(8) * 2 - 1));
		// flight with air drag and gravity (worked out exactly for the age, no stepping)
		let along, fall;
		if (drag > 1e-4) {
			const ek = Math.exp(-drag * age);
			along = (1 - ek) / drag;
			fall = (age - along) / drag;
		} else { along = age; fall = 0.5 * age * age; }
		if (d.collide) pos.copy(collidingFlight(e, d, k, pos, _v.clone().multiplyScalar(speed), g, drag, L, age, node));
		else {
			pos.addScaledVector(_v, speed * along);
			pos.y += g * fall;
		}
		const f = age / L;
		const alpha = d.opacity * Math.min(1, d.fade_in > 0 ? age / d.fade_in : 1) * Math.min(1, d.fade_out > 0 ? (L - age) / d.fade_out : 1);
		const sz = (d.size + (d.size_end - d.size) * f) * (1 + d.size_jitter * (r(9) * 2 - 1));
		const rot = r(10) * Math.PI * 2 + d.spin * age * (r(11) * 2 - 1) * 2;
		const frames = Math.max(1, Math.round(d.sheet_cols) * Math.round(d.sheet_rows));
		const frame = frames <= 1 ? 0 : d.sheet_mode == 'random' ? Math.floor(r(12) * frames) : d.sheet_mode == 'fps' ? Math.floor(age * d.sheet_fps) % frames : Math.min(frames - 1, Math.floor(f * frames));
		list.push({pos, alpha, sz, rot, f, frame});
	}
	if (e.paths) for (const k of e.paths.keys()) if (k < k0 || k > k1) e.paths.delete(k);
	// far ones first, so the near ones are drawn over them
	if (!d.additive && camera) {
		const cp = camera.getWorldPosition(new THREE.Vector3()), dir = camera.getWorldDirection(new THREE.Vector3());
		list.forEach(o => { o.depth = _v.copy(o.pos).sub(cp).dot(dir); });
		list.sort((a, b) => b.depth - a.depth);
	}
	ensureCapacity(e, list.length);
	list.forEach((o, i) => {
		e.pos[i * 3] = o.pos.x; e.pos[i * 3 + 1] = o.pos.y; e.pos[i * 3 + 2] = o.pos.z;
		e.col[i * 4] = _c0.r + (_c1.r - _c0.r) * o.f; e.col[i * 4 + 1] = _c0.g + (_c1.g - _c0.g) * o.f; e.col[i * 4 + 2] = _c0.b + (_c1.b - _c0.b) * o.f; e.col[i * 4 + 3] = Math.max(0, o.alpha);
		e.sr[i * 3] = Math.max(0.01, o.sz); e.sr[i * 3 + 1] = o.rot; e.sr[i * 3 + 2] = o.frame;
	});
	e.geometry.instanceCount = list.length;
	for (const name of ['iPos', 'iColor', 'iSizeRot']) e.geometry.attributes[name].needsUpdate = true;
	const m = e.material;
	m.uniforms.map.value = particleTexture(d);
	m.uniforms.glow.value = d.glow;
	m.uniforms.sheet.value.set(Math.max(1, Math.round(d.sheet_cols)), Math.max(1, Math.round(d.sheet_rows)));
	m.uniforms.additive.value = d.additive ? 1 : 0;
	m.uniforms.linearOut.value = enabled ? 1 : 0;   // the Render view works in linear light
	const blending = d.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
	if (m.blending != blending) { m.blending = blending; m.needsUpdate = true; }
	e.mesh.visible = list.length > 0;
}


// --- particles that hit things: the flight of every particle is worked out once, in small steps, and kept; a step that
// would pass through a solid element (or the floor) stops on it, bounces off it or sticks to it
const PARTICLE_DT = 1 / 40;
function particleColliders(node) {
	const own = new Set();
	if (node instanceof Group) { const walk = g => (g.children || []).forEach(c => { own.add(c); if (c instanceof Group) walk(c); }); walk(node); }
	own.add(node);
	return [...Cube.all, ...Mesh.all].filter(el => el.mesh && !own.has(el) && el.visibility !== false && el.mesh.visible !== false).map(el => el.mesh);
}
function collisionKey(node, d, colliders) {
	let sig = 0;
	colliders.forEach((m, i) => { const e = m.matrixWorld.elements; sig += (e[12] * 1.1 + e[13] * 1.3 + e[14] * 1.7 + e[0] + e[5] * 2 + e[10] * 3) * (1 + i * 0.01); });
	return JSON.stringify([d.bounce, d.friction, d.stick, d.speed, d.gravity, d.drag, d.lifetime, d.direction, d.spread, d.shape, d.local, d.follow, d.yaw, d.pitch]) + '|' + colliders.length + '|' + sig.toFixed(3);
}
const _ray = new THREE.Raycaster(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
function collidingFlight(e, d, k, start, v0, g, drag, L, age, node) {
	if (!e.paths) e.paths = new Map();
	if (e.collide_frame !== e.frame_id) {
		e.collide_frame = e.frame_id;
		const colliders = particleColliders(node), key = collisionKey(node, d, colliders);
		if (key !== e.collide_key) { e.paths.clear(); e.collide_key = key; }
		e.colliders = colliders;
		e.floor_y = Project && Project.model_3d ? Project.model_3d.localToWorld(new THREE.Vector3()).y : 0;
	}
	let path = e.paths.get(k);
	if (!path) {
		const steps = Math.ceil(L / PARTICLE_DT) + 1, pts = new Float32Array(steps * 3);
		const p = start.clone(), v = v0.clone(), next = new THREE.Vector3(), seg = new THREE.Vector3();
		let stuck = false;
		for (let i = 0; i < steps; i++) {
			pts.set([p.x, p.y, p.z], i * 3);
			if (stuck) continue;
			v.y += g * PARTICLE_DT;
			if (drag > 0) v.multiplyScalar(Math.exp(-drag * PARTICLE_DT));
			next.copy(p).addScaledVector(v, PARTICLE_DT);
			seg.subVectors(next, p);
			const len = seg.length();
			let hit = null;
			if (len > 1e-6 && e.colliders.length) {
				_ray.set(p, seg.clone().divideScalar(len));
				_ray.near = 0; _ray.far = len;
				const hits = _ray.intersectObjects(e.colliders, false);
				if (hits.length && hits[0].face) {
					_nm.getNormalMatrix(hits[0].object.matrixWorld);
					hit = {point: hits[0].point, normal: _n.copy(hits[0].face.normal).applyMatrix3(_nm).normalize().clone()};
				}
			}
			// the floor of the scene
			if (!hit && p.y >= e.floor_y && next.y < e.floor_y) {
				const f = (p.y - e.floor_y) / Math.max(1e-6, p.y - next.y);
				hit = {point: p.clone().lerp(next, f), normal: new THREE.Vector3(0, 1, 0)};
			}
			if (!hit) { p.copy(next); continue; }
			if (hit.normal.dot(v) > 0) hit.normal.negate();
			p.copy(hit.point).addScaledVector(hit.normal, 0.05);
			if (d.stick) { v.set(0, 0, 0); stuck = true; continue; }
			// bounce: the part along the normal turns round (less by the bounce), the rest is slowed by friction
			const vn = hit.normal.clone().multiplyScalar(v.dot(hit.normal)), vt = v.clone().sub(vn);
			v.copy(vt.multiplyScalar(1 - Math.min(1, d.friction))).addScaledVector(vn, -Math.max(0, Math.min(1, d.bounce)));
			if (v.lengthSq() < 0.25 && hit.normal.y > 0.5) { v.set(0, 0, 0); stuck = true; }
		}
		path = pts;
		e.paths.set(k, path);
	}
	const fi = Math.min(path.length / 3 - 1.001, Math.max(0, age / PARTICLE_DT)), i = Math.floor(fi), w = fi - i;
	return new THREE.Vector3(path[i * 3] + (path[i * 3 + 3] - path[i * 3]) * w, path[i * 3 + 1] + (path[i * 3 + 4] - path[i * 3 + 1]) * w, path[i * 3 + 2] + (path[i * 3 + 5] - path[i * 3 + 2]) * w);
}

const lightClockIsAnimation = () => video_clock !== null || !!(typeof Modes != 'undefined' && Modes.animate && typeof Animation != 'undefined' && Animation.selected);

let particles_frame = -1;
function updateParticles(camera) {
	if (!Project) { clearEmitters(); return; }
	const nodes = particleNodes();
	const seen = new Set();
	const t = lightClock();
	for (const node of nodes) {
		seen.add(node.uuid);
		try { const e = emitterFor(node); e.frame_id = (e.frame_id || 0) + 1; updateEmitter(node, e, t, camera); } catch (err) { console.warn('[Render view] particles', err); }
	}
	for (const uuid of [...emitters.keys()]) if (!seen.has(uuid)) removeEmitter(uuid);
}

// --- the Particles panel ----------------------------------------------------------

// the selected object that has particles (or, for the Add button, any selected object)
function selectedParticleNode(any) {
	if (!Project) return null;
	const list = [...(Outliner.selected || []), ...((Group.multi_selected && Group.multi_selected.length) ? Group.multi_selected : (Group.first_selected ? [Group.first_selected] : []))];
	return list.find(hasParticles) || (any ? list.find(n => n instanceof Cube || n instanceof Mesh || n instanceof Group) || null : null);
}

function undoAspects(node) { return node instanceof Group ? {outliner: true, groups: [node]} : {elements: [node]}; }

function addParticlesTo(node) {
	if (!node) { Blockbench.showQuickMessage(tr('msg_select_one'), 2000); return; }
	if (!hasParticles(node)) {
		Undo.initEdit(undoAspects(node));
		node.render_particles = Object.assign({}, DEFAULT_PARTICLES);
		Undo.finishEdit('Add particles', undoAspects(node));
		Project.saved = false;
	}
	refreshParticlePanel(true);
}

function spawnParticleGroup() {
	if (!Project) return;
	const preview = Preview.selected;
	Undo.initEdit({outliner: true, groups: [], selection: true});
	let origin = new THREE.Vector3(0, 16, 0);
	if (preview && preview.controls) origin = Project.model_3d.worldToLocal(preview.controls.target.clone());
	const group = new Group({name: tr('particles_title'), origin: origin.toArray().map(n => Math.round(n * 100) / 100), color: 5}).init();
	group.render_particles = Object.assign({}, DEFAULT_PARTICLES);
	group.addTo();
	group.select();
	Undo.finishEdit('Add particles', {outliner: true, groups: [group], selection: true});
	Project.saved = false;
	refreshParticlePanel(true);
}

let particle_panel = null, particle_panel_shown = false, particle_editing = null;
function refreshParticlePanel(force) {
	const show = !!selectedParticleNode(false);
	if (show != particle_panel_shown || force) {
		particle_panel_shown = show;
		try { if (typeof updateInterfacePanels == 'function') updateInterfacePanels(); else if (typeof updateInterface == 'function') updateInterface(); } catch (err) { /* the interface is busy */ }
	}
	if (particle_panel && particle_panel.inside_vue) particle_panel.inside_vue.loadSel();
}

function particlePanelComponent() {
	return {
		data() { return {uuid: '', name: '', p: null, textures: [], builtins: PARTICLE_TEXTURES}; },
		mounted() { this.loadSel(); },
		methods: {
			t(key) { return tr(key); },
			loadSel() {
				const node = selectedParticleNode(false);
				this.uuid = node ? node.uuid : '';
				this.name = node ? node.name : '';
				this.p = node ? particlesOf(node) : null;
				this.textures = Project ? Texture.all.map(t => ({id: 'tex:' + t.uuid, name: t.name})) : [];
			},
			node() { return this.uuid ? findNode(this.uuid) : null; },
			live() {
				const node = this.node();
				if (!node) return;
				if (!particle_editing) { Undo.initEdit(undoAspects(node)); particle_editing = node; }
				node.render_particles = Object.assign({}, this.p);
				Project.saved = false;
			},
			done() {
				if (!particle_editing) return;
				Undo.finishEdit('Edit particles', undoAspects(particle_editing));
				particle_editing = null;
			},
			change() { this.live(); this.done(); },
			remove() {
				const node = this.node();
				if (!node) return;
				Undo.initEdit(undoAspects(node));
				node.render_particles = null;
				Undo.finishEdit('Remove particles', undoAspects(node));
				Project.saved = false;
				refreshParticlePanel(true);
			},
			restart() {
				const e = emitters.get(this.uuid);
				if (e) { e.epoch = null; e.history = []; }
			},
			pickTexture() {
				if (this.p.texture != 'load') return this.change();
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'image/*';
				input.onchange = () => {
					const file = input.files[0];
					if (!file) { this.loadSel(); return; }
					const reader = new FileReader();
					reader.onload = () => {
						const img = new Image();
						img.onload = () => {
							const k = Math.min(1, 256 / Math.max(img.width, img.height));
							const c = document.createElement('canvas');
							c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
							c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
							this.p.image = c.toDataURL('image/png');
							this.p.image_name = file.name;
							this.p.texture = 'image';
							this.change();
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
				<div v-if="!p" class="render_hint">{{ t('pt_hint_none') }}</div>
				<template v-else>
					<div class="render_row"><b>{{ name }}</b><span><button @click="restart()" :title="t('pt_restart')"><i class="material-icons" style="font-size: 16px;">replay</i></button> <button @click="remove()">{{ t('pt_remove') }}</button></span></div>
					<label class="render_row">{{ t('pt_enabled') }} <input type="checkbox" v-model="p.enabled" @change="change()"></label>

					<div class="render_cap">{{ t('pt_amount') }}</div>
					<div class="render_slider"><span class="label">{{ t('pt_count') }}</span><input type="range" min="1" max="3000" step="1" v-model.number="p.count" @input="live()" @change="done()"><span>{{ p.count }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_lifetime') }}</span><input type="range" min="0.1" max="20" step="0.1" v-model.number="p.lifetime" @input="live()" @change="done()"><span>{{ p.lifetime }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_life_jitter') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.life_jitter" @input="live()" @change="done()"><span>{{ p.life_jitter }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_fade_in') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="p.fade_in" @input="live()" @change="done()"><span>{{ p.fade_in }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_fade_out') }}</span><input type="range" min="0" max="10" step="0.05" v-model.number="p.fade_out" @input="live()" @change="done()"><span>{{ p.fade_out }}</span></div>
					<label class="render_row" :title="t('pt_prewarm_tip')">{{ t('pt_prewarm') }} <input type="checkbox" v-model="p.prewarm" @change="change()"></label>

					<div class="render_cap">{{ t('pt_look') }}</div>
					<label class="render_row">{{ t('texture') }}
						<select v-model="p.texture" @change="pickTexture()">
							<option v-for="k in builtins" :value="k">{{ t('ptx_' + k) }}</option>
							<option v-for="x in textures" :value="x.id">{{ x.name }}</option>
							<option v-if="p.image" value="image">{{ p.image_name || t('loaded_image') }}</option>
							<option value="load">{{ t('load_image') }}</option>
						</select>
					</label>
					<label class="render_row">{{ t('pt_color') }} <input type="color" v-model="p.color" @input="live()" @change="done()"></label>
					<label class="render_row">{{ t('pt_color_end') }} <input type="color" v-model="p.color_end" @input="live()" @change="done()"></label>
					<div class="render_slider"><span class="label">{{ t('opacity') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.opacity" @input="live()" @change="done()"><span>{{ p.opacity }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_size') }}</span><input type="range" min="0.2" max="80" step="0.1" v-model.number="p.size" @input="live()" @change="done()"><span>{{ p.size }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_size_end') }}</span><input type="range" min="0" max="160" step="0.1" v-model.number="p.size_end" @input="live()" @change="done()"><span>{{ p.size_end }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_size_jitter') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.size_jitter" @input="live()" @change="done()"><span>{{ p.size_jitter }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_spin') }}</span><input type="range" min="0" max="10" step="0.1" v-model.number="p.spin" @input="live()" @change="done()"><span>{{ p.spin }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_glow') }}</span><input type="range" min="0" max="20" step="0.1" v-model.number="p.glow" @input="live()" @change="done()"><span>{{ p.glow }}</span></div>
					<label class="render_row" :title="t('pt_additive_tip')">{{ t('pt_additive') }} <input type="checkbox" v-model="p.additive" @change="change()"></label>
					<div class="render_cap">{{ t('pt_sheet') }}</div>
					<div class="render_slider" :title="t('pt_sheet_tip')"><span class="label">{{ t('pt_sheet_cols') }}</span><input type="range" min="1" max="16" step="1" v-model.number="p.sheet_cols" @input="live()" @change="done()"><span>{{ p.sheet_cols }}</span></div>
					<div class="render_slider" :title="t('pt_sheet_tip')"><span class="label">{{ t('pt_sheet_rows') }}</span><input type="range" min="1" max="16" step="1" v-model.number="p.sheet_rows" @input="live()" @change="done()"><span>{{ p.sheet_rows }}</span></div>
					<template v-if="p.sheet_cols * p.sheet_rows > 1">
						<label class="render_row">{{ t('pt_sheet_mode') }}
							<select v-model="p.sheet_mode" @change="change()"><option value="life">{{ t('psm_life') }}</option><option value="fps">{{ t('psm_fps') }}</option><option value="random">{{ t('psm_random') }}</option></select>
						</label>
						<div class="render_slider" v-if="p.sheet_mode == 'fps'"><span class="label">{{ t('pt_sheet_fps') }}</span><input type="range" min="1" max="60" step="1" v-model.number="p.sheet_fps" @input="live()" @change="done()"><span>{{ p.sheet_fps }}</span></div>
					</template>

					<div class="render_cap">{{ t('pt_motion') }}</div>
					<label class="render_row">{{ t('pt_direction') }}
						<select v-model="p.direction" @change="change()">
							<option value="up">{{ t('pd_up') }}</option>
							<option value="down">{{ t('pd_down') }}</option>
							<option value="sideways">{{ t('pd_sideways') }}</option>
							<option value="all">{{ t('pd_all') }}</option>
							<option value="custom">{{ t('pd_custom') }}</option>
						</select>
					</label>
					<template v-if="p.direction == 'custom'">
						<div class="render_slider"><span class="label">{{ t('pt_yaw') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="p.yaw" @input="live()" @change="done()"><span>{{ p.yaw }}°</span></div>
						<div class="render_slider"><span class="label">{{ t('pt_pitch') }}</span><input type="range" min="-90" max="90" step="1" v-model.number="p.pitch" @input="live()" @change="done()"><span>{{ p.pitch }}°</span></div>
					</template>
					<label class="render_row">{{ t('pt_local') }} <input type="checkbox" v-model="p.local" @change="change()"></label>
					<div class="render_slider"><span class="label">{{ t('pt_spread') }}</span><input type="range" min="0" max="180" step="1" v-model.number="p.spread" @input="live()" @change="done()"><span>{{ p.spread }}°</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_speed') }}</span><input type="range" min="0" max="300" step="0.5" v-model.number="p.speed" @input="live()" @change="done()"><span>{{ p.speed }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_speed_jitter') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.speed_jitter" @input="live()" @change="done()"><span>{{ p.speed_jitter }}</span></div>
					<div class="render_slider" :title="t('pt_gravity_tip')"><span class="label">{{ t('pt_gravity') }}</span><input type="range" min="-200" max="400" step="1" v-model.number="p.gravity" @input="live()" @change="done()"><span>{{ p.gravity }}</span></div>
					<div class="render_slider"><span class="label">{{ t('pt_drag') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="p.drag" @input="live()" @change="done()"><span>{{ p.drag }}</span></div>
					<label class="render_row">{{ t('pt_shape') }}
						<select v-model="p.shape" @change="change()">
							<option value="point">{{ t('ps_point') }}</option>
							<option value="box">{{ t('ps_box') }}</option>
						</select>
					</label>
					<label class="render_row" :title="t('pt_follow_tip')">{{ t('pt_follow') }} <input type="checkbox" v-model="p.follow" @change="change()"></label>
					<label class="render_row" :title="t('pt_collide_tip')">{{ t('pt_collide') }} <input type="checkbox" v-model="p.collide" @change="change()"></label>
					<template v-if="p.collide">
						<label class="render_row">{{ t('pt_stick') }} <input type="checkbox" v-model="p.stick" @change="change()"></label>
						<template v-if="!p.stick">
							<div class="render_slider"><span class="label">{{ t('pt_bounce') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.bounce" @input="live()" @change="done()"><span>{{ p.bounce }}</span></div>
							<div class="render_slider"><span class="label">{{ t('pt_friction') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="p.friction" @input="live()" @change="done()"><span>{{ p.friction }}</span></div>
						</template>
					</template>
					<div class="render_hint">{{ t('pt_hint') }}</div>
				</template>
			</div>`,
	};
}

// ---------------------------------------------------------------------------
// Decals: a picture (dirt, a sign, a crack, a bullet hole) laid onto the surface of a cube or a mesh. It wraps over the
// shape like a sticker, moves with the element, and is drawn in the normal view and in the Render view.
// Place one with "Place decal" and a click on an object; the decals of the selected element are edited in the Render panel.
// ---------------------------------------------------------------------------

const DEFAULT_DECAL = {image: '', name: '', pos: [0, 0, 0], normal: [0, 1, 0], angle: 0, width: 8, height: 8, depth: 4, opacity: 1};
const decalsOf = el => Array.isArray(el.render_decals) ? el.render_decals : [];
const decal_objects = new Map();   // element uuid -> {key, group, mesh}
const decal_textures = new Map();
function decalTexture(image) {
	if (image && image.startsWith('tex:')) return textureFor({kind: 'texture', uuid: image.slice(4)}, true);
	if (image && image.startsWith('data:')) {
		if (!decal_textures.has(image)) {
			const t = new THREE.TextureLoader().load(image);
			t.encoding = THREE.sRGBEncoding;
			decal_textures.set(image, t);
		}
		return decal_textures.get(image);
	}
	return builtinParticleTexture('dot');
}
function removeDecalObject(uuid) {
	const rec = decal_objects.get(uuid);
	if (!rec) return;
	if (rec.group.parent) rec.group.parent.remove(rec.group);
	rec.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
	decal_objects.delete(uuid);
}
function clearDecals() { [...decal_objects.keys()].forEach(removeDecalObject); }
const noRaycast = () => {};
function syncDecals() {
	if (!Project) { clearDecals(); return; }
	const seen = new Set();
	for (const el of [...Cube.all, ...Mesh.all]) {
		if (!decalsOf(el).length || !el.mesh || !el.mesh.geometry) continue;
		seen.add(el.uuid);
		const mesh = el.mesh, pos = mesh.geometry.attributes.position;
		const key = JSON.stringify(el.render_decals) + '|' + mesh.geometry.uuid + '|' + (pos ? pos.version + ':' + pos.count : '') + '|' + (enabled ? 1 : 0);
		const rec = decal_objects.get(el.uuid);
		if (rec && rec.key === key && rec.group.parent === mesh) continue;
		removeDecalObject(el.uuid);
		if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
		const group = new THREE.Group();
		group.name = 'render_decals';
		group.userData.render_no_fx = true;
		mesh.updateMatrixWorld(true);
		const inv = mesh.matrixWorld.clone().invert();
		for (const d0 of decalsOf(el)) {
			const d = Object.assign({}, DEFAULT_DECAL, d0);
			try {
				const p = new THREE.Vector3(...d.pos).applyMatrix4(mesh.matrixWorld);
				const n = new THREE.Vector3(...d.normal).transformDirection(mesh.matrixWorld);
				const helper = new THREE.Object3D();
				helper.position.copy(p);
				helper.lookAt(p.clone().add(n));
				helper.rotateZ(d.angle * Math.PI / 180);
				const geometry = new THREE.DecalGeometry(mesh, p, helper.rotation, new THREE.Vector3(Math.max(0.01, d.width), Math.max(0.01, d.height), Math.max(0.01, d.depth)));
				geometry.applyMatrix4(inv);
				const map = decalTexture(d.image);
				const material = new THREE.MeshStandardMaterial({map, transparent: true, opacity: d.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.85, metalness: 0, alphaTest: 0.01});
				if (!enabled) { material.map = map; }
				const dm = new THREE.Mesh(geometry, material);
				dm.renderOrder = 3;
				dm.raycast = noRaycast;   // Blockbench's clicks go to the element under it
				group.add(dm);
			} catch (err) { console.warn('[Render view] decal', err); }
		}
		mesh.add(group);
		decal_objects.set(el.uuid, {key, group, mesh});
	}
	for (const uuid of [...decal_objects.keys()]) if (!seen.has(uuid)) removeDecalObject(uuid);
}

// placing: the next click on an object puts a decal there
let decal_place = null;   // {image, name, size, angle, opacity} while placing
function setDecalPlacing(on, settings) {
	decal_place = on ? Object.assign({}, settings) : null;
	if (on) Blockbench.showQuickMessage(tr('decal_place_msg'), 2500);
	if (panel && panel.inside_vue) panel.inside_vue.decal_placing = !!decal_place;
}
function onDecalPress(event) {
	if (!decal_place || event.button !== 0 || !Project || event.__render_decal) return;
	const previews = (typeof Preview != 'undefined' && Preview.all) || [];
	const preview = previews.find(p => p.canvas && p.canvas === event.target);
	if (!preview) return;
	const rect = preview.canvas.getBoundingClientRect();
	const ray = new THREE.Raycaster();
	ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), preview.camera);
	const els = [...Cube.all, ...Mesh.all].filter(el => el.mesh && el.mesh.visible !== false && el.visibility !== false);
	const hits = ray.intersectObjects(els.map(el => el.mesh), false).filter(h => h.face);
	event.__render_decal = true;
	event.preventDefault();
	event.stopImmediatePropagation();
	if (!hits.length) { Blockbench.showQuickMessage(tr('decal_miss'), 1500); return; }
	const hit = hits[0], el = els.find(e => e.mesh === hit.object);
	const local = hit.object.worldToLocal(hit.point.clone());
	const s = decal_place;
	Undo.initEdit({elements: [el]});
	el.render_decals = [...decalsOf(el), Object.assign({}, DEFAULT_DECAL, {image: s.image, name: s.name, pos: local.toArray().map(v => Math.round(v * 1000) / 1000), normal: hit.face.normal.toArray().map(v => Math.round(v * 1e4) / 1e4),
		angle: s.angle, width: s.size, height: s.size * (s.aspect || 1), depth: Math.max(1, s.size * 0.5), opacity: s.opacity})];
	Undo.finishEdit('Place decal', {elements: [el]});
	Project.saved = false;
	el.select && el.select();
	syncDecals();
	if (panel && panel.inside_vue) panel.inside_vue.loadSel();
}
function onDecalKey(event) { if (decal_place && event.key == 'Escape') setDecalPlacing(false); }

// ---------------------------------------------------------------------------
// Ctrl + drag a texture onto an object: the texture goes on every face, and the UV map of the object is moved (and made
// smaller, if it has to be) so it lies inside the texture
// ---------------------------------------------------------------------------

let ctrl_down = false;
function trackCtrl(event) { ctrl_down = !!(event.ctrlKey || event.metaKey); }
function uvSizeOf(texture) {
	if (typeof Format != 'undefined' && Format.per_texture_uv_size && texture && texture.uv_width) return [texture.uv_width, texture.uv_height];
	return [Project.texture_width || 16, Project.texture_height || 16];
}
function fitUVs(el, texture) {
	const [W, H] = uvSizeOf(texture);
	if (el instanceof Cube && el.box_uv) {
		const size = el.size ? el.size() : [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
		const lw = 2 * (Math.ceil(size[2]) + Math.ceil(size[0])), lh = Math.ceil(size[2]) + Math.ceil(size[1]);
		if (lw <= W && lh <= H) {
			const off = el.uv_offset || [0, 0];
			el.uv_offset = [clampN(off[0], 0, W - lw), clampN(off[1], 0, H - lh)];
			return;
		}
		if (el.setUVMode) el.setUVMode(false); else el.box_uv = false;
	}
	// every uv coordinate of the element: a box round them, then moved inside the texture, smaller if it does not fit
	const coords = [];
	if (el instanceof Mesh) for (const f of Object.values(el.faces)) for (const k in f.uv) coords.push(f.uv[k]);
	else for (const f of Object.values(el.faces)) if (f.uv) coords.push([f.uv[0], f.uv[1]], [f.uv[2], f.uv[3]]);
	if (!coords.length) return;
	let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
	coords.forEach(c => { minU = Math.min(minU, c[0]); maxU = Math.max(maxU, c[0]); minV = Math.min(minV, c[1]); maxV = Math.max(maxV, c[1]); });
	const bw = Math.max(1e-6, maxU - minU), bh = Math.max(1e-6, maxV - minV);
	const s = Math.min(1, W / bw, H / bh);
	const u0 = clampN(minU, 0, W - bw * s), v0 = clampN(minV, 0, H - bh * s);
	const fu = u => Math.round((u0 + (u - minU) * s) * 1000) / 1000, fv = v => Math.round((v0 + (v - minV) * s) * 1000) / 1000;
	if (el instanceof Mesh) {
		for (const f of Object.values(el.faces)) for (const k in f.uv) f.uv[k] = [fu(f.uv[k][0]), fv(f.uv[k][1])];
	} else {
		for (const f of Object.values(el.faces)) if (f.uv) f.uv = [fu(f.uv[0]), fv(f.uv[1]), fu(f.uv[2]), fv(f.uv[3])];
	}
}
const clampN = (v, a, b) => Math.max(a, Math.min(Math.max(a, b), v));
const apply_originals = new Map();
function patchApplyTexture() {
	for (const type of [Cube, Mesh]) {
		const original = type.prototype.applyTexture;
		if (typeof original != 'function' || apply_originals.has(type)) continue;
		apply_originals.set(type, original);
		type.prototype.applyTexture = function (texture, faces) {
			const dragging = typeof Blockbench != 'undefined' && Blockbench.hasFlag && Blockbench.hasFlag('dragging_textures');
			if (!(ctrl_down && dragging) || !texture) return original.call(this, texture, faces);
			const out = original.call(this, texture, true);
			try {
				fitUVs(this, texture);
				if (typeof Canvas != 'undefined') Canvas.updateView({elements: [this], element_aspects: {uv: true, faces: true}});
				if (typeof UVEditor != 'undefined' && UVEditor.loadData) UVEditor.loadData();
			} catch (err) { console.warn('[Render view] fit uv', err); }
			return out;
		};
	}
}
function unpatchApplyTexture() {
	apply_originals.forEach((original, type) => { type.prototype.applyTexture = original; });
	apply_originals.clear();
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
		bloom: {label: tr('cam_bloom'), type: 'range', value: d.bloom, min: 0, max: 5, step: 0.05},
		motion_blur: {label: tr('cam_motion'), type: 'range', value: d.motion_blur, min: 0, max: 1, step: 0.05},
		focus_info: {type: 'info', text: tr('cam_focus')},
		focus: {label: tr('cam_focus'), type: 'select', options, value: d.focus || ''},
		focus_blur: {label: tr('cam_focus_blur'), type: 'range', value: d.focus_blur, min: 0, max: 1, step: 0.05},
	} : {
		kind: {label: tr('light_kind'), type: 'select', value: d.kind || 'point', options: {point: tr('lk_point'), spot: tr('lk_spot'), area: tr('lk_area')}},
		color: {label: tr('color'), type: 'color', value: d.color},
		strength: {label: tr('light_strength'), type: 'range', value: d.strength, min: 0, max: 20, step: 0.1},
		angle: {label: tr('light_angle'), type: 'range', value: d.angle ?? 30, min: 1, max: 89, step: 1, condition: f => f.kind == 'spot'},
		softness: {label: tr('light_softness'), type: 'range', value: d.softness ?? 0.4, min: 0, max: 1, step: 0.05, condition: f => f.kind == 'spot'},
		area_w: {label: tr('light_area_w'), type: 'range', value: d.area_w ?? 16, min: 0.5, max: 200, step: 0.5, condition: f => f.kind == 'area'},
		area_h: {label: tr('light_area_h'), type: 'range', value: d.area_h ?? 16, min: 0.5, max: 200, step: 0.5, condition: f => f.kind == 'area'},
		radius: {label: tr('light_radius'), type: 'range', value: d.radius, min: 4, max: 400, step: 1},
		shadows: {label: tr('light_shadows'), type: 'checkbox', value: !!d.shadows},
		flicker: {label: tr('light_flicker'), type: 'select', value: d.flicker || 'none', options: FLICKER_OPTIONS()},
		flicker_amount: {label: tr('light_flicker_amount'), type: 'range', value: d.flicker_amount ?? 0.5, min: 0, max: 1, step: 0.05},
		flicker_speed: {label: tr('light_flicker_speed'), type: 'range', value: d.flicker_speed ?? 1, min: 0.1, max: 5, step: 0.1},
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
					['roughness', 'metalness', 'normal_strength', 'emission_strength', 'opacity', 'transmission', 'ior', 'clearcoat', 'env', 'thickness', 'wave', 'wave_speed', 'wave_size', 'tint_distance'].forEach(k => { d[k] = num(d[k]); });
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
							<img :src="big" width="160" height="160" class="render_mat_ball">
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

						<h3>{{ t('base') }}</h3>
						<label class="render_row">{{ t('color') }} <input type="color" v-model="d.color" @change="save()"></label>
						<label class="render_row">{{ t('texture') }}
							<select :value="mapValue('map')" @change="setMap('map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('map')" value="image">{{ imageName('map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>
						</label>

						<h3>{{ t('roughness') }}</h3>
						<div class="render_slider"><input type="range" min="0" max="1" step="0.01" v-model.number="d.roughness" @change="save()"><span>{{ d.roughness }}</span></div>
						<label class="render_row">{{ t('map') }}
							<select :value="mapValue('roughness_map')" @change="setMap('roughness_map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('roughness_map')" value="image">{{ imageName('roughness_map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>
						</label>

						<h3>{{ t('metalness') }}</h3>
						<div class="render_slider"><input type="range" min="0" max="1" step="0.01" v-model.number="d.metalness" @change="save()"><span>{{ d.metalness }}</span></div>
						<label class="render_row">{{ t('map') }}
							<select :value="mapValue('metalness_map')" @change="setMap('metalness_map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('metalness_map')" value="image">{{ imageName('metalness_map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>
						</label>

						<h3>{{ t('normal') }}</h3>
						<label class="render_row">{{ t('map') }}
							<select :value="mapValue('normal_map')" @change="setMap('normal_map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('normal_map')" value="image">{{ imageName('normal_map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>
						</label>
						<div class="render_slider"><span class="label">{{ t('normal_strength') }}</span><input type="range" min="0" max="3" step="0.05" v-model.number="d.normal_strength" @change="save()"><span>{{ d.normal_strength }}</span></div>

						<h3>{{ t('emission') }}</h3>
						<label class="render_row">{{ t('color') }} <input type="color" v-model="d.emission" @change="save()"></label>
						<div class="render_slider"><span class="label">{{ t('emission_strength') }}</span><input type="range" min="0" max="10" step="0.1" v-model.number="d.emission_strength" @change="save()"><span>{{ d.emission_strength }}</span></div>
						<label class="render_row">{{ t('map') }}
							<select :value="mapValue('emission_map')" @change="setMap('emission_map', $event.target.value)">
								<option value="">{{ t('none') }}</option>
								<option v-for="tx in textures" :value="'texture:' + tx.uuid">{{ tx.name }}</option>
								<option v-if="imageName('emission_map')" value="image">{{ imageName('emission_map') }}</option>
								<option value="load">{{ t('load_image') }}</option>
							</select>
						</label>

						<h3>{{ t('transparency') }}</h3>
						<div class="render_slider"><input type="range" min="0" max="1" step="0.01" :value="Math.round((1 - d.opacity) * 100) / 100" @input="d.opacity = Math.round((1 - $event.target.valueAsNumber) * 100) / 100" @change="save()"><span>{{ Math.round((1 - d.opacity) * 100) }}%</span></div>
						<div class="render_slider"><span class="label">{{ t('glass') }}</span><input type="range" min="0" max="1" step="0.01" v-model.number="d.transmission" @change="save()"><span>{{ d.transmission }}</span></div>
						<template v-if="d.transmission > 0">
							<div class="render_slider"><span class="label">{{ t('ior') }}</span><input type="range" min="1" max="2.4" step="0.01" v-model.number="d.ior" @change="save()"><span>{{ d.ior }}</span></div>
							<div class="render_slider"><span class="label">{{ t('thickness') }}</span><input type="range" min="0" max="32" step="0.5" v-model.number="d.thickness" @change="save()"><span>{{ d.thickness }}</span></div>
							<div class="render_slider"><span class="label">{{ t('wave') }}</span><input type="range" min="0" max="2" step="0.05" v-model.number="d.wave" @change="save()"><span>{{ d.wave }}</span></div>
							<div class="render_slider" v-if="d.wave > 0"><span class="label">{{ t('wave_speed') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="d.wave_speed" @change="save()"><span>{{ d.wave_speed }}</span></div>
							<div class="render_slider" v-if="d.wave > 0"><span class="label">{{ t('wave_size') }}</span><input type="range" min="0.2" max="12" step="0.1" v-model.number="d.wave_size" @change="save()"><span>{{ d.wave_size }}</span></div>
							<label class="render_row">{{ t('tint') }} <input type="color" v-model="d.tint" @change="save()"></label>
							<div class="render_slider"><span class="label">{{ t('tint_distance') }}</span><input type="range" min="0" max="200" step="1" v-model.number="d.tint_distance" @change="save()"><span>{{ d.tint_distance }}</span></div>
						</template>
						<div class="render_slider"><span class="label">{{ t('clearcoat') }}</span><input type="range" min="0" max="1" step="0.01" v-model.number="d.clearcoat" @change="save()"><span>{{ d.clearcoat }}</span></div>
						<div class="render_slider"><span class="label">{{ t('env') }}</span><input type="range" min="0" max="3" step="0.05" v-model.number="d.env" @change="save()"><span>{{ d.env }}</span></div>
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

let panel = null, toggle = null, materials_action = null, video_action = null, properties = [], style_node = null;
let editing_decals = null, editing_group = null, add_light_action = null, add_camera_action = null, poll = null, add_particles_action = null, particles_action = null;

const num_ = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
function panelComponent() {
	return {
		data() { return Object.assign({decal_image: '', decal_image_name: '', decal_size: 8, decal_angle: 0, decal_opacity: 1, decal_placing: false, decal_list: [], decal_el: '', decal_el_name: '', decal_textures: [], decal_loaded: [],
			flicker_options: FLICKER_OPTIONS(), project: '', light: null, light_uuid: '', cam: null, cam_uuid: '', looking: false, focus_name: ''}, DEFAULT_SETTINGS); },
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
			placeDecal() {
				if (decal_place) { setDecalPlacing(false); return; }
				const loaded = this.decal_loaded.find(x => x.id == this.decal_image);
				let aspect = 1;
				const tex = this.decal_image.startsWith('tex:') && Texture.all.find(t => 'tex:' + t.uuid == this.decal_image);
				if (tex && tex.width && tex.height) aspect = tex.height / tex.width;
				if (loaded) aspect = loaded.aspect;
				setDecalPlacing(true, {image: loaded ? loaded.data : this.decal_image, name: loaded ? loaded.name : (tex ? tex.name : ''), size: num_(this.decal_size, 8), angle: num_(this.decal_angle, 0), opacity: num_(this.decal_opacity, 1), aspect});
			},
			loadDecalImage() {
				const input = document.createElement('input');
				input.type = 'file'; input.accept = 'image/*';
				input.onchange = () => {
					const file = input.files[0];
					if (!file) return;
					const reader = new FileReader();
					reader.onload = () => {
						const img = new Image();
						img.onload = () => {
							const k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas');
							c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
							c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
							const id = 'img:' + Date.now();
							this.decal_loaded.push({id, name: file.name, data: c.toDataURL('image/png'), aspect: c.height / c.width});
							this.decal_image = id;
						};
						img.src = reader.result;
					};
					reader.readAsDataURL(file);
				};
				input.click();
			},
			saveDecals(final) {
				const el = [...Cube.all, ...Mesh.all].find(e => e.uuid == this.decal_el);
				if (!el) return;
				if (!editing_decals) { Undo.initEdit({elements: [el]}); editing_decals = el; }
				el.render_decals = this.decal_list.map(d => Object.assign({}, d, {width: num_(d.width, 8), height: num_(d.height, 8), angle: num_(d.angle, 0), opacity: num_(d.opacity, 1), depth: num_(d.depth, 4)}));
				Project.saved = false;
				if (final) { Undo.finishEdit('Edit decal', {elements: [el]}); editing_decals = null; }
			},
			deleteDecal(i) { this.decal_list.splice(i, 1); this.saveDecals(true); },
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
				// the decals of the selected element
				const el = (Outliner.selected || []).find(e => e instanceof Cube || e instanceof Mesh);
				this.decal_el = el ? el.uuid : ''; this.decal_el_name = el ? el.name : '';
				this.decal_list = el ? decalsOf(el).map(d => Object.assign({}, DEFAULT_DECAL, d)) : [];
				this.decal_textures = Texture.all.map(t => ({id: 'tex:' + t.uuid, name: t.name}));
				if (!this.decal_image && this.decal_textures.length) this.decal_image = this.decal_textures[0].id;
				this.decal_placing = !!decal_place;
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
			video() { openVideoDialog(); },
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
				<button @click="materials()" style="width: 100%; margin-bottom: 4px;">{{ t('materials') }}</button>
				<button @click="video()" style="width: 100%; margin-bottom: 8px;">{{ t('vid_action') }}</button>
				<h3>{{ t('light') }}</h3>
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

					<h3>{{ t('skybox') }}</h3>
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

				<h3>{{ t('effects') }}</h3>
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
				<div class="render_slider"><span class="label">{{ t('motion_blur') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="motion_blur" @input="save()"><span>{{ motion_blur }}</span></div>
					<div class="render_slider"><span class="label">{{ t('vignette') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="vignette" @input="save()"><span>{{ vignette }}</span></div>

					<h3>{{ t('rt') }}</h3>
					<label class="render_row">{{ t('rt') }} <input type="checkbox" v-model="rt" @change="save()"></label>
					<template v-if="rt">
						<div class="render_slider"><span class="label">{{ t('rt_rays') }}</span><input type="range" min="1" max="24" step="1" v-model.number="rt_rays" @input="save()"><span>{{ rt_rays }}</span></div>
						<div class="render_slider"><span class="label">{{ t('rt_distance') }}</span><input type="range" min="4" max="200" step="1" v-model.number="rt_distance" @input="save()"><span>{{ rt_distance }}</span></div>
						<div class="render_slider"><span class="label">{{ t('rt_bounce') }}</span><input type="range" min="0" max="4" step="0.05" v-model.number="rt_bounce" @input="save()"><span>{{ rt_bounce }}</span></div>
						<div class="render_slider"><span class="label">{{ t('rt_ao') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="rt_ao" @input="save()"><span>{{ rt_ao }}</span></div>
						<div class="render_slider" v-if="shadows"><span class="label">{{ t('rt_shadows') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="rt_shadows" @input="save()"><span>{{ rt_shadows }}</span></div>
						<label class="render_row">{{ t('rt_accumulate') }} <input type="checkbox" v-model="rt_accumulate" @change="save()"></label>
						<div class="render_slider" :title="t('rt_video_samples_tip')"><span class="label">{{ t('rt_video_samples') }}</span><input type="range" min="1" max="32" step="1" v-model.number="rt_video_samples" @input="save()"><span>{{ rt_video_samples }}</span></div>
						<div class="render_hint">{{ t('rt_hint') }}</div>
					</template>

					<h3>{{ t('gloss') }}</h3>
					<label class="render_row">{{ t('gloss') }} <input type="checkbox" v-model="gloss" @change="save()"></label>
					<template v-if="gloss">
						<div class="render_slider"><span class="label">{{ t('gloss_strength') }}</span><input type="range" min="0" max="2" step="0.05" v-model.number="gloss_strength" @input="save()"><span>{{ gloss_strength }}</span></div>
						<div class="render_slider"><span class="label">{{ t('gloss_distance') }}</span><input type="range" min="20" max="1500" step="10" v-model.number="gloss_distance" @input="save()"><span>{{ gloss_distance }}</span></div>
						<div class="render_slider"><span class="label">{{ t('gloss_rays') }}</span><input type="range" min="1" max="8" step="1" v-model.number="gloss_rays" @input="save()"><span>{{ gloss_rays }}</span></div>
						<div class="render_hint">{{ t('gloss_hint') }}</div>
					</template>

					<h3>{{ t('fog') }}</h3>
					<label class="render_row">{{ t('fog') }} <input type="checkbox" v-model="fog" @change="save()"></label>
					<template v-if="fog">
						<div class="render_slider"><span class="label">{{ t('fog_density') }}</span><input type="range" min="0" max="3" step="0.02" v-model.number="fog_density" @input="save()"><span>{{ fog_density }}</span></div>
						<label class="render_row">{{ t('fog_color') }} <input type="color" v-model="fog_color" @input="save()"></label>
						<div class="render_slider"><span class="label">{{ t('fog_brightness') }}</span><input type="range" min="0" max="3" step="0.05" v-model.number="fog_brightness" @input="save()"><span>{{ fog_brightness }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_light') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="fog_light" @input="save()"><span>{{ fog_light }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_anisotropy') }}</span><input type="range" min="0" max="0.9" step="0.05" v-model.number="fog_anisotropy" @input="save()"><span>{{ fog_anisotropy }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_base') }}</span><input type="range" min="-100" max="300" step="1" v-model.number="fog_base" @input="save()"><span>{{ fog_base }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_height') }}</span><input type="range" min="1" max="500" step="1" v-model.number="fog_height" @input="save()"><span>{{ fog_height }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_noise') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="fog_noise" @input="save()"><span>{{ fog_noise }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_noise_size') }}</span><input type="range" min="4" max="300" step="1" v-model.number="fog_noise_size" @input="save()"><span>{{ fog_noise_size }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_wind') }}</span><input type="range" min="0" max="100" step="0.5" v-model.number="fog_wind" @input="save()"><span>{{ fog_wind }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_wind_dir') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="fog_wind_dir" @input="save()"><span>{{ fog_wind_dir }}°</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_distance') }}</span><input type="range" min="50" max="3000" step="10" v-model.number="fog_distance" @input="save()"><span>{{ fog_distance }}</span></div>
						<div class="render_slider"><span class="label">{{ t('fog_quality') }}</span><input type="range" min="8" max="128" step="1" v-model.number="fog_quality" @input="save()"><span>{{ fog_quality }}</span></div>
						<label class="render_row" v-if="shadows">{{ t('fog_shafts') }} <input type="checkbox" v-model="fog_shafts" @change="save()"></label>
						<div class="render_hint">{{ t('fog_hint') }}</div>
					</template>

					<h3>{{ t('decals') }}</h3>
					<label class="render_row">{{ t('decal_image') }}
						<select v-model="decal_image">
							<option v-for="x in decal_textures" :value="x.id">{{ x.name }}</option>
							<option v-for="x in decal_loaded" :value="x.id">{{ x.name }}</option>
						</select>
					</label>
					<button class="render_btn" @click="loadDecalImage()">{{ t('load_image') }}</button>
					<div class="render_slider"><span class="label">{{ t('decal_size') }}</span><input type="range" min="0.5" max="64" step="0.5" v-model.number="decal_size"><span>{{ decal_size }}</span></div>
					<div class="render_slider"><span class="label">{{ t('decal_angle') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="decal_angle"><span>{{ decal_angle }}°</span></div>
					<div class="render_slider"><span class="label">{{ t('opacity') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="decal_opacity"><span>{{ decal_opacity }}</span></div>
					<button class="render_btn" :class="{active: decal_placing}" @click="placeDecal()">{{ decal_placing ? t('decal_placing') : t('decal_place') }}</button>
					<div v-if="decal_list.length" class="render_box">
						<div class="render_cap">{{ t('decals_of') }} {{ decal_el_name }}</div>
						<div v-for="(d, i) in decal_list" style="border-top: 1px solid var(--color-border); padding-top: 4px; margin-top: 4px;">
							<div class="render_row"><span>{{ d.name || (t('decal') + ' ' + (i + 1)) }}</span><button @click="deleteDecal(i)">✕</button></div>
							<div class="render_slider"><span class="label">{{ t('decal_width') }}</span><input type="range" min="0.5" max="128" step="0.5" v-model.number="d.width" @input="saveDecals(false)" @change="saveDecals(true)"><span>{{ d.width }}</span></div>
							<div class="render_slider"><span class="label">{{ t('decal_height') }}</span><input type="range" min="0.5" max="128" step="0.5" v-model.number="d.height" @input="saveDecals(false)" @change="saveDecals(true)"><span>{{ d.height }}</span></div>
							<div class="render_slider"><span class="label">{{ t('decal_angle') }}</span><input type="range" min="-180" max="180" step="1" v-model.number="d.angle" @input="saveDecals(false)" @change="saveDecals(true)"><span>{{ d.angle }}°</span></div>
							<div class="render_slider"><span class="label">{{ t('decal_depth') }}</span><input type="range" min="0.2" max="64" step="0.2" v-model.number="d.depth" @input="saveDecals(false)" @change="saveDecals(true)"><span>{{ d.depth }}</span></div>
							<div class="render_slider"><span class="label">{{ t('opacity') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="d.opacity" @input="saveDecals(false)" @change="saveDecals(true)"><span>{{ d.opacity }}</span></div>
						</div>
					</div>
					<div class="render_hint">{{ t('decal_hint') }}</div>

					<h3>{{ t('lights') }}</h3>
					<button @click="spawn('light')" class="render_btn">{{ t('add_light') }}</button>
					<div v-if="light" class="render_box">
						<div class="render_cap">{{ t('light_selected') }}</div>
						<label class="render_row">{{ t('light_kind') }}
							<select v-model="light.kind" @change="liveLight(); endEdit('Edit light')">
								<option value="point">{{ t('lk_point') }}</option><option value="spot">{{ t('lk_spot') }}</option><option value="area">{{ t('lk_area') }}</option>
							</select>
						</label>
						<template v-if="light.kind == 'spot'">
							<div class="render_slider"><span class="label">{{ t('light_angle') }}</span><input type="range" min="1" max="89" step="1" v-model.number="light.angle" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.angle }}°</span></div>
							<div class="render_slider"><span class="label">{{ t('light_softness') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="light.softness" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.softness }}</span></div>
						</template>
						<template v-if="light.kind == 'area'">
							<div class="render_slider"><span class="label">{{ t('light_area_w') }}</span><input type="range" min="0.5" max="200" step="0.5" v-model.number="light.area_w" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.area_w }}</span></div>
							<div class="render_slider"><span class="label">{{ t('light_area_h') }}</span><input type="range" min="0.5" max="200" step="0.5" v-model.number="light.area_h" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.area_h }}</span></div>
						</template>
						<label class="render_row">{{ t('color') }} <input type="color" v-model="light.color" @input="liveLight()" @change="endEdit('Edit light')"></label>
						<div class="render_slider"><span class="label">{{ t('light_strength') }}</span><input type="range" min="0" max="20" step="0.1" v-model.number="light.strength" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.strength }}</span></div>
						<div class="render_slider"><span class="label">{{ t('light_radius') }}</span><input type="range" min="4" max="400" step="1" v-model.number="light.radius" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.radius }}</span></div>
						<label class="render_row">{{ t('light_shadows') }} <input type="checkbox" v-model="light.shadows" @change="liveLight(); endEdit('Edit light')"></label>
						<label class="render_row">{{ t('light_flicker') }}
							<select v-model="light.flicker" @change="liveLight(); endEdit('Edit light')">
								<option v-for="(label, key) in flicker_options" :value="key">{{ label }}</option>
							</select>
						</label>
						<template v-if="light.flicker && light.flicker != 'none'">
							<div class="render_slider"><span class="label">{{ t('light_flicker_amount') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="light.flicker_amount" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.flicker_amount }}</span></div>
							<div class="render_slider"><span class="label">{{ t('light_flicker_speed') }}</span><input type="range" min="0.1" max="5" step="0.1" v-model.number="light.flicker_speed" @input="liveLight()" @change="endEdit('Edit light')"><span>{{ light.flicker_speed }}</span></div>
						</template>
					</div>
					<div v-else class="render_hint">{{ t('light_hint') }}</div>

					<h3>{{ t('cameras') }}</h3>
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
						<div class="render_slider"><span class="label">{{ t('cam_bloom') }}</span><input type="range" min="0" max="5" step="0.05" v-model.number="cam.bloom" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.bloom }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_motion') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="cam.motion_blur" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.motion_blur }}</span></div>
						<div class="render_slider"><span class="label">{{ t('cam_temperature') }}</span><input type="range" min="-1" max="1" step="0.02" v-model.number="cam.temperature" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.temperature }}</span></div>
						<div class="render_cap">{{ t('cam_focus') }}</div>
						<div class="render_row"><span>{{ focus_name || t('cam_focus_none') }}</span><span><button @click="focusSelected()">{{ t('cam_focus_pick') }}</button> <button v-if="cam.focus" @click="clearFocus()">{{ t('cam_focus_clear') }}</button></span></div>
						<div class="render_slider" v-if="cam.focus"><span class="label">{{ t('cam_focus_blur') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="cam.focus_blur" @input="liveCamera()" @change="endEdit('Edit camera')"><span>{{ cam.focus_blur }}</span></div>
					</div>
					<div v-else class="render_hint">{{ t('cam_hint') }}</div>
			</div>`,
	};
}

// ---------------------------------------------------------------------------
// Video: the animation seen through a camera, with every effect, to an MP4 file.
// Frames are made one by one (never faster or slower than the video says), so the result has exactly the chosen frame rate
// however heavy the scene is. H.264 comes from the browser (WebCodecs); the MP4 container is written here.
// ---------------------------------------------------------------------------

// an MP4 file from encoded frames. samples: [{data: Uint8Array, key: bool}] (H.264: length-prefixed NAL units); o.codec 'avc1' with o.avcC (the
// decoder config), or 'vp09' with o.codec_string ('vp09.00.40.08')
function muxMp4(samples, o) {
	const cat = parts => {
		let n = 0;
		parts.forEach(p => { n += p.length; });
		const out = new Uint8Array(n);
		let at = 0;
		parts.forEach(p => { out.set(p, at); at += p.length; });
		return out;
	};
	const u32 = n => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
	const u16 = n => Uint8Array.of((n >> 8) & 255, n & 255);
	const zeros = n => new Uint8Array(n);
	const str = s => Uint8Array.from(s, c => c.charCodeAt(0));
	const box = (type, ...parts) => { const body = cat(parts); return cat([u32(8 + body.length), str(type), body]); };
	const full = (type, flags, ...parts) => box(type, Uint8Array.of(0, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
	const matrix = cat([u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000)]);
	const N = samples.length, unit = 1000, scale = Math.round(o.fps * unit);
	const movie_ms = Math.round(N / o.fps * 1000);
	const data_size = samples.reduce((n, s) => n + s.data.length, 0);

	const sizes = cat(samples.map(s => u32(s.data.length)));
	const keys = [];
	samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
	const vp9 = o.codec == 'vp09';
	const parts = vp9 ? o.codec_string.split('.') : [];
	const decoder = vp9
		? box('vpcC', Uint8Array.of(1, 0, 0, 0, parseInt(parts[1]) || 0, parseInt(parts[2]) || 40, (8 << 4) | (1 << 1), 1, 1, 1, 0, 0))
		: box('avcC', o.avcC);
	const avc1 = box(vp9 ? 'vp09' : 'avc1', zeros(6), u16(1), zeros(16), u16(o.width), u16(o.height), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), decoder);
	const stbl = offset => box('stbl',
		full('stsd', 0, u32(1), avc1),
		full('stts', 0, u32(1), u32(N), u32(unit)),
		keys.length < N ? full('stss', 0, u32(keys.length), cat(keys.map(u32))) : new Uint8Array(0),
		full('stsc', 0, u32(1), u32(1), u32(N), u32(1)),
		full('stsz', 0, u32(0), u32(N), sizes),
		full('stco', 0, u32(1), u32(offset)));
	const moov = offset => box('moov',
		full('mvhd', 0, u32(0), u32(0), u32(1000), u32(movie_ms), u32(0x10000), u16(0x100), zeros(10), matrix, zeros(24), u32(2)),
		box('trak',
			full('tkhd', 3, u32(0), u32(0), u32(1), zeros(4), u32(movie_ms), zeros(8), u16(0), u16(0), u16(0), zeros(2), matrix, u32(o.width * 65536), u32(o.height * 65536)),
			box('mdia',
				full('mdhd', 0, u32(0), u32(0), u32(scale), u32(N * unit), u16(0x55c4), u16(0)),
				full('hdlr', 0, zeros(4), str('vide'), zeros(12), str('VideoHandler'), zeros(1)),
				box('minf',
					full('vmhd', 1, zeros(8)),
					box('dinf', full('dref', 0, u32(1), full('url ', 1))),
					stbl(offset)))));
	const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
	const head = ftyp.length + moov(0).length;
	const mdat_head = cat([u32(8 + data_size), str('mdat')]);
	return cat([ftyp, moov(head + 8), mdat_head, ...samples.map(s => s.data)]);
}

// the encoder settings the machine can really do (the first that works), or null
async function pickEncoder(width, height, fps, bitrate) {
	if (typeof VideoEncoder == 'undefined' || typeof VideoFrame == 'undefined') return null;
	const big = width * height > 1920 * 1088 ? (fps > 30 ? '34' : '33') : (fps > 30 ? '2A' : '28');
	const vp9_level = width * height > 1920 * 1088 ? '51' : '40';
	// H.264 is the best choice (plays everywhere); VP9 inside MP4 is the fallback when this machine has no H.264 encoder
	for (const codec of ['avc1.6400' + big, 'avc1.4D00' + big, 'avc1.4200' + big, 'avc1.640034', 'vp09.00.' + vp9_level + '.08']) {
		for (const hardware of ['prefer-hardware', 'no-preference']) {
			const config = {codec, width, height, bitrate, framerate: fps, hardwareAcceleration: hardware, latencyMode: 'quality'};
			if (codec.startsWith('avc1')) config.avc = {format: 'avc'};
			try { const r = await VideoEncoder.isConfigSupported(config); if (r && r.supported) return config; } catch (err) { /* next */ }
		}
	}
	return null;
}

const VIDEO_QUALITY = {draft: 0.06, normal: 0.11, high: 0.18, max: 0.3};   // bits per pixel
const VIDEO_SIZES = {'1280x720': [1280, 720], '1920x1080': [1920, 1080], '2560x1440': [2560, 1440], '3840x2160': [3840, 2160], '1080x1920': [1080, 1920], '1080x1080': [1080, 1080], '854x480': [854, 480]};

let video_job = null;
const renderHooks = () => (globalThis.__renderHooks || []).filter(h => { try { return !h.available || h.available(); } catch (err) { return false; } });

// o: {camera: group|null, width, height, fps, start, end, quality}
async function renderVideo(o) {
	if (video_job) { Blockbench.showQuickMessage(tr('vid_busy'), 2500); return; }
	const frames = Math.max(1, Math.round((o.end - o.start) * o.fps));
	const width = Math.max(16, Math.round(o.width / 2) * 2), height = Math.max(16, Math.round(o.height / 2) * 2);
	const bitrate = Math.round(width * height * o.fps * (VIDEO_QUALITY[o.quality] || 0.11));
	const encoder_config = await pickEncoder(width, height, o.fps, bitrate);
	if (!encoder_config) { Blockbench.showQuickMessage(tr('vid_no_encoder'), 6000); return; }

	const hooks = o.hooks === false ? [] : renderHooks();
	const job = video_job = {cancel: false};
	const was_enabled = enabled;
	const saved_camera = Project.render_active_camera;
	const saved_settings = Project.render_settings, saved_camera_data = o.camera ? o.camera.render_camera : null;
	const saved_time = Timeline.time;
	const saved_selected = Preview.selected;
	let renderer = null, preview = null, status = null, bar = null;
	const hidden = [];
	const dialog = new Dialog({
		id: 'render_video_progress', title: tr('vid_title'), width: 420, darken: true, cancel_on_click_outside: false,
		lines: [`<div id="render_video_status" style="margin: 6px 0;">…</div><progress id="render_video_bar" max="1" value="0" style="width: 100%;"></progress>`],
		buttons: [tr('vid_cancel')],
		onButton() { job.cancel = true; },
		onCancel() { job.cancel = true; },
	});
	dialog.show();
	status = document.getElementById('render_video_status'); bar = document.getElementById('render_video_bar');
	const samples = [];
	let avcC = null, failure = null, encoder = null;
	try {
		if (!was_enabled) setEnabled(true);
		Project.render_active_camera = o.camera ? o.camera.uuid : '';
		if (o.effects == 'all') {
			// every effect on for this video only (the project's own settings come back afterwards)
			Project.render_settings = Object.assign({}, settingsOf(), {ao: true, ssr: true, bloom: true, fxaa: true, shadows: true});
			if (o.camera) { const d = cameraOf(o.camera); o.camera.render_camera = Object.assign({}, d, {motion_blur: d.motion_blur > 0 ? d.motion_blur : 0.5}); }
			else Project.render_settings.motion_blur = Math.max(0.5, Project.render_settings.motion_blur || 0);
		}
		if (typeof Transformer != 'undefined' && Transformer.visible) { hidden.push(Transformer); Transformer.visible = false; }
		scene.traverse(obj => { if (obj.visible && (obj.isLine || obj.isPoints || obj.isSprite)) { hidden.push(obj); obj.visible = false; } });

		const canvas = document.createElement('canvas');
		canvas.width = width; canvas.height = height;
		renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
		renderer.setPixelRatio(1);
		renderer.setSize(width, height, false);
		const camera = new THREE.PerspectiveCamera(50, width / height, 1, 30000);
		const view = saved_selected && saved_selected.camera;
		if (!o.camera && view) { camera.position.copy(view.position); camera.quaternion.copy(view.quaternion); camera.fov = view.fov || 50; }
		camera.updateProjectionMatrix();
		preview = {renderer, camera, canvas, isOrtho: false, offline: true, controls: {target: new THREE.Vector3(), update() {}}, css_renderer: null};

		const place = () => {
			if (!o.camera || !o.camera.mesh) return;
			o.camera.mesh.updateMatrixWorld(true);
			camera.position.copy(o.camera.mesh.getWorldPosition(new THREE.Vector3()));
			camera.quaternion.copy(o.camera.mesh.getWorldQuaternion(new THREE.Quaternion()));
			const d = cameraOf(o.camera);
			if (camera.fov != d.fov) { camera.fov = d.fov; camera.updateProjectionMatrix(); }
			camera.updateMatrixWorld(true);
		};
		const at = time => {
			video_clock = time;   // (a flickering light flickers by the video's time)
			if (Animation.selected) {
				Timeline.setTime(time);
				Animator.preview();
			}
			scene.updateMatrixWorld(true);
			hooks.forEach(h => { if (h.frame) h.frame(time); });   // other plugins (soft bodies) put their shapes in the frame
			scene.updateMatrixWorld(true);
			place();
		};
		hooks.forEach(h => { if (h.start) h.start(o); });
		// one frame before the first, so the motion blur of the first picture is right too
		if (o.start > 0) { at(Math.max(0, o.start - 1 / o.fps)); renderWithEffects.call(preview); }

		encoder = new VideoEncoder({
			output: (chunk, meta) => {
				const data = new Uint8Array(chunk.byteLength);
				chunk.copyTo(data);
				samples.push({data, key: chunk.type == 'key'});
				const d = meta && meta.decoderConfig && meta.decoderConfig.description;
				if (!avcC && d) avcC = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
			},
			error: err => { failure = err; },
		});
		encoder.configure(encoder_config);
		const t0 = performance.now();
		for (let i = 0; i < frames && !job.cancel && !failure; i++) {
			at(o.start + i / o.fps);
			renderWithEffects.call(preview);
			const frame = new VideoFrame(canvas, {timestamp: Math.round(i * 1e6 / o.fps), duration: Math.round(1e6 / o.fps)});
			encoder.encode(frame, {keyFrame: i % Math.max(1, Math.round(o.fps * 2)) == 0});
			frame.close();
			while (encoder.encodeQueueSize > 6 && !failure) await new Promise(r => setTimeout(r, 4));
			if (i % 2 == 1 || i == frames - 1) {
				const per = (performance.now() - t0) / (i + 1), left = Math.max(0, Math.round(per * (frames - i - 1) / 1000));
				if (status) status.textContent = `${tr('vid_frame')} ${i + 1} / ${frames} · ${per < 1000 ? Math.round(1000 / per * 10) / 10 + ' ' + tr('vid_fps_render') : Math.round(per / 100) / 10 + ' ' + tr('vid_s_frame')} · ${tr('vid_left')} ${left} ${tr('vid_sec')}`;
				if (bar) bar.value = (i + 1) / frames;
				await new Promise(r => setTimeout(r, 0));   // the interface stays alive and Cancel works
			}
		}
		if (!job.cancel && !failure) await encoder.flush();
		if (failure) throw failure;
		if (!job.cancel) {
			const vp9 = encoder_config.codec.startsWith('vp09');
			if ((!vp9 && !avcC) || !samples.length) throw new Error('the encoder gave no data');
			const file = muxMp4(samples, {width, height, fps: o.fps, avcC, codec: vp9 ? 'vp09' : 'avc1', codec_string: encoder_config.codec});
			const name = (Project.name || 'render').replace(/[\\/:*?"<>|]+/g, '_') + (o.camera ? '_' + o.camera.name : '');
			Blockbench.export({type: 'MP4 video', extensions: ['mp4'], name, content: file, savetype: 'buffer'}, () => Blockbench.showQuickMessage(tr('vid_done'), 3000));
		}
	} catch (err) {
		console.error('[Render view] video', err);
		Blockbench.showQuickMessage(tr('vid_error') + ': ' + (err && err.message || err), 6000);
	} finally {
		try { if (encoder && encoder.state != 'closed') encoder.close(); } catch (err) { /* closed */ }
		hidden.forEach(obj => { obj.visible = true; });
		hooks.forEach(h => { try { if (h.end) h.end(); } catch (err) { console.warn(err); } });
		if (preview) { const p = pipelines.get(preview); if (p) { disposePipeline(p); pipelines.delete(preview); } }
		if (rig && renderer) { const sk = rig.skies.get(renderer); if (sk) { if (sk.env) sk.env.dispose(); if (sk.bg) sk.bg.dispose(); rig.skies.delete(renderer); } }
		if (renderer) renderer.dispose();
		Project.render_active_camera = saved_camera;
		Project.render_settings = saved_settings;
		if (o.camera) o.camera.render_camera = saved_camera_data;
		video_clock = null;
		if (Animation.selected) { Timeline.setTime(saved_time); Animator.preview(); }
		if (!was_enabled) setEnabled(false);
		dialog.close();
		video_job = null;
	}
}

function openVideoDialog(preset_camera) {
	if (!Project) return;
	const cameras = Group.all.filter(isCamera);
	const options = {'': tr('vid_view')};
	cameras.forEach(g => { options[g.uuid] = g.name; });
	const active = preset_camera || activeCameraGroup() || cameras[0] || null;
	const animations = Animation.all || [];
	const length = Animation.selected ? Animation.selected.length : (animations[0] ? animations[0].length : 3);
	new Dialog({
		id: 'render_video', title: tr('vid_title'), width: 460,
		form: {
			camera: {label: tr('vid_camera'), type: 'select', options, value: active ? active.uuid : ''},
			size: {label: tr('vid_size'), type: 'select', options: {'1280x720': '1280 × 720 (HD)', '1920x1080': '1920 × 1080 (Full HD)', '2560x1440': '2560 × 1440 (2K)', '3840x2160': '3840 × 2160 (4K)', '1080x1920': '1080 × 1920 (' + tr('vid_vertical') + ')', '1080x1080': '1080 × 1080', '854x480': '854 × 480'}, value: '1920x1080'},
			fps: {label: tr('vid_fps'), type: 'select', options: {24: '24', 30: '30', 60: '60'}, value: '30'},
			start: {label: tr('vid_start'), type: 'number', value: 0, min: 0, step: 0.1},
			end: {label: tr('vid_end'), type: 'number', value: Math.round(length * 100) / 100 || 3, min: 0.1, step: 0.1},
			effects: {label: tr('vid_effects'), type: 'select', options: {all: tr('vid_fx_all'), project: tr('vid_fx_project')}, value: 'all'},
			...(renderHooks().length ? {hooks: {label: renderHooks().map(h => h.label ? h.label() : h.name).join(', '), type: 'checkbox', value: true}} : {}),
			quality: {label: tr('vid_quality'), type: 'select', options: {draft: tr('vid_q_draft'), normal: tr('vid_q_normal'), high: tr('vid_q_high'), max: tr('vid_q_max')}, value: 'high'},
			hint: {type: 'info', text: tr('vid_hint')},
		},
		onConfirm(v) {
			const [w, h] = VIDEO_SIZES[v.size] || [1920, 1080];
			const camera = v.camera ? Group.all.find(g => g.uuid == v.camera) : null;
			const start = Math.max(0, Number(v.start) || 0), end = Math.max(start + 0.05, Number(v.end) || length);
			renderVideo({camera, width: w, height: h, fps: parseInt(v.fps) || 30, start, end, quality: v.quality, effects: v.effects, hooks: v.hooks !== false});
		},
	}).show();
}

const STYLE = `
	#panel_render_view .render_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.render_panel h3, .render_materials h3 { font-size: 1em; text-transform: uppercase; opacity: 0.8; margin: 10px 0 4px; }
	.render_row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 3px 0; }
	.render_row input[type=number], .render_row input[type=text], .render_row select { width: 58%; }
	.render_row input[type=color] { width: 58%; height: 22px; border: 1px solid var(--color-border); background: transparent; padding: 0; }
	.render_slider { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
	.render_slider .label { width: 40%; }
	.render_slider input[type=range] { flex: 1; min-width: 0; }
	.render_slider > span:last-child { width: 38px; text-align: right; opacity: 0.8; }
	.render_panel input[type=text], .render_panel select, .render_materials input[type=text], .render_materials select {
		background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px;
	}
	.render_materials { display: flex; gap: 12px; height: 560px; }
	.render_mat_list { width: 250px; overflow-y: auto; padding-right: 4px; }
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
	.render_mat_top { display: flex; gap: 12px; align-items: flex-start; }
	.render_mat_ball { border-radius: 6px; background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 20px 20px; }
`;

if (typeof __RENDER_EXPORT !== 'undefined') __RENDER_EXPORT({pickEditorHelper, onIconPress, syncEditorHelpers, openSettings, addGroupMenuActions, removeGroupMenuActions, drawSkyCanvas, skyEquirect, FinalShader, SKY_PRESETS, DEFAULT_SETTINGS, frustumGeometry, helperIcon, buildPipeline, pipelineFor, renderWithEffects, setEnabled, settingsOf, limitBrightness, MotionBlurPass, muxMp4, renderVideo, updateParticles, particlePanelComponent, panelComponent, addParticlesTo, emitters, syncDecals, fitUVs, onDecalPress, setDecalPlacing, decal_objects, setVideoClock: t => { video_clock = t; }});

Plugin.register('render', {
	title: 'Render view',
	author: 'Claude',
	description: 'Blender style materials with ball previews, sun, skybox and sky light, point lights, shadows, post effects (AO, reflections, bloom, depth of field, camera motion blur) and cameras with lens effects (distortion, chromatic aberration, vignette, grain, focus on an object).',
	about: 'Turn it on with **View > Render view**. The **Render** panel sets the light and the effects, **Materials…** opens the materials window. Every texture of the project has a material; custom materials can be assigned to selected elements. The **Skybox** section draws a sky (day, sunset, night, overcast, custom colors or your own 360° panorama) as background, sky light and reflections. **Add light** and **Add camera** (Add buttons / Edit menu) create an empty group that shines, or a camera you can look through with its own lens and look effects. Uses three.js r129 post processing examples (MIT).',
	icon: 'photo_camera',
	version: '0.8.0',
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
		properties.push(new Property(Cube, 'object', 'render_particles', {default: null}));
		properties.push(new Property(Mesh, 'object', 'render_particles', {default: null}));
		properties.push(new Property(Group, 'object', 'render_particles', {default: null}));
		properties.push(new Property(Cube, 'array', 'render_decals', {default: []}));
		properties.push(new Property(Mesh, 'array', 'render_decals', {default: []}));
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
		video_action = new Action('render_video', {
			name: tr('vid_action'), description: tr('vid_action_desc'), icon: 'movie', category: 'view',
			condition: () => !!Project, click() { openVideoDialog(); },
		});
		MenuBar.addAction(toggle, 'view');
		MenuBar.addAction(materials_action, 'view');
		MenuBar.addAction(video_action, 'view');
		add_light_action = new Action('add_render_light', {
			name: tr('act_add_light'), description: tr('act_add_light_desc'), icon: 'lightbulb', category: 'edit',
			condition: () => !!Project, click() { spawnGroup('light'); },
		});
		add_camera_action = new Action('add_render_camera', {
			name: tr('act_add_camera'), description: tr('act_add_camera_desc'), icon: 'videocam', category: 'edit',
			condition: () => !!Project, click() { spawnGroup('camera'); },
		});
		add_particles_action = new Action('add_render_particles', {
			name: tr('act_add_particles'), description: tr('act_add_particles_desc'), icon: 'grain', category: 'edit',
			condition: () => !!Project, click() { spawnParticleGroup(); },
		});
		particles_action = new Action('render_particles', {
			name: tr('act_particles'), description: tr('act_particles_desc'), icon: 'grain', category: 'edit',
			condition: () => !!Project && !!selectedParticleNode(true),
			click() { addParticlesTo(selectedParticleNode(true)); },
		});
		injectAddActions([add_light_action, add_camera_action, add_particles_action]);
		patchMenusOpening([add_light_action, add_camera_action, add_particles_action]);
		addGroupMenuActions();
		if (!injected.length) {
			// no Add menu found: they are still in the Edit menu and in the action search (Ctrl+K)
			try { MenuBar.addAction(add_light_action, 'edit'); MenuBar.addAction(add_camera_action, 'edit'); MenuBar.addAction(add_particles_action, 'edit'); } catch (err) { console.warn('[Render view]', err); }
		}
		// "Particles…" in the right click menu of cubes, meshes and groups, and in the Edit menu
		for (const type of [Cube, Mesh, Group]) { try { type.prototype.menu.addAction(particles_action); } catch (err) { console.warn('[Render view] particles menu', err); } }
		try { MenuBar.addAction(particles_action, 'edit'); } catch (err) { console.warn('[Render view]', err); }
		particle_panel = new Panel('render_particles', {
			name: tr('particles_title'),
			icon: 'grain',
			condition: () => !!Project && !!selectedParticleNode(false),
			growable: true,
			resizable: true,
			min_height: 200,
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [300, 520], height: 520},
			component: particlePanelComponent(),
		});
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
		document.addEventListener('pointerdown', onDecalPress, true);
		document.addEventListener('mousedown', onDecalPress, true);
		document.addEventListener('pointerdown', onIconPress, true);
		document.addEventListener('mousedown', onIconPress, true);
		document.addEventListener('keydown', onDecalKey, true);
		for (const type of ['keydown', 'keyup', 'mousemove', 'mouseup', 'pointerup', 'pointermove']) document.addEventListener(type, trackCtrl, true);
		patchApplyTexture();
		},
	onunload() {
		setEnabled(false);
		limitBrightness(false);
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
		document.removeEventListener('pointerdown', onDecalPress, true);
		document.removeEventListener('mousedown', onDecalPress, true);
		document.removeEventListener('keydown', onDecalKey, true);
		for (const type of ['keydown', 'keyup', 'mousemove', 'mouseup', 'pointerup', 'pointermove']) document.removeEventListener(type, trackCtrl, true);
		unpatchApplyTexture();
		clearDecals();
		clearEditorHelpers();
		removeAddActions();
		removeGroupMenuActions();
		if (open_settings) open_settings.cancel();
		clearEmitters();
		if (particle_panel) { particle_panel.delete(); particle_panel = null; }
		if (particles_action) {
			for (const type of [Cube, Mesh, Group]) { try { type.prototype.menu.removeAction(particles_action); } catch (err) { /* menu already gone */ } }
			try { MenuBar.removeAction('edit.render_particles'); } catch (err) { /* it was never there */ }
			particles_action.delete();
			particles_action = null;
		}
		for (const [action, path] of [[add_light_action, 'edit.add_render_light'], [add_camera_action, 'edit.add_render_camera'], [add_particles_action, 'edit.add_render_particles']]) {
			if (!action) continue;
			try { MenuBar.removeAction(path); } catch (err) { /* it was never in the Edit menu */ }
			action.delete();
		}
		add_light_action = null; add_camera_action = null; add_particles_action = null;
		if (materials_dialog) { materials_dialog.close && materials_dialog.close(); materials_dialog = null; }
		if (panel) panel.delete();
		if (toggle) { MenuBar.removeAction('view.render_view'); toggle.delete(); }
		if (materials_action) { MenuBar.removeAction('view.render_materials'); materials_action.delete(); }
		if (video_action) { MenuBar.removeAction('view.render_video'); video_action.delete(); video_action = null; }
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
		if (thumb) { thumb.renderer.dispose(); thumb = null; }
		window.RenderView = undefined;
	},
});

function onSelection() {
	syncEditorHelpers();
	refreshParticlePanel(false);
	if (panel && panel.inside_vue) panel.inside_vue.loadSel();
}

function onProject() {
	invalidate();
	syncEditorHelpers();
	if (panel && panel.inside_vue) panel.inside_vue.load();
	for (const p of pipelines.values()) disposePipeline(p);
	pipelines.clear();
	restoreMaterials();
	clearEmitters();
	refreshParticlePanel(true);
}

// for testing from the console
window.RenderView = {setEnabled, openMaterials, settingsOf, materialStore, invalidate, pipelines, get rig() { return rig; }};

})();

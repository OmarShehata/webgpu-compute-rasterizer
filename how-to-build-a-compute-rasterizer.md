# How to Build a Compute Rasterizer with WebGPU

This is a step by step guide for building a rasterizer using WebGPU compute shaders. This guide assumes you know (1) some computer graphics fundamentals (how to use a model view projection matrix etc) and (2) how to set up a basic WebGPU program. 

This is a great "first big WebGPU project" because it covers many of the new features introduced by WebGPU: storage buffers, compute shaders, and atomic operations. 

The final result will be a renderer that can take a list of triangles from a simple glTF model and draw them with shading based on distance to the camera.

![](media/rotating-model.gif)

## Why build a rasterizer with compute shaders?

I was trying to understand what types of things could you now do in WebGPU that weren't possible before when I found [Markus Schütz's point cloud rendering talk](https://youtu.be/OIfqWD5NlNc?t=2441). He talks about how it's significantly faster to render very large point clouds (> 100 million points) with computer shaders, about **10x faster**, compared to rendering directly with point primitives using the graphics hardware.

This was really surprising. My understanding of why this could be so fast is that they can use additional knowledge they have about the scene (that many millions of points end up in the same pixel) to create a more efficient rendering pipeline than what the traditional graphics hardware is optimized for. For example, they talk about carefully ordering the vertex buffer and tuning the number of GPU work group threads to minimize costly blocking operations. Whereas in the regular pipeline, your performance will suffer if you have a lot of overdraw like this and you can't tweak how the GPU threads are synchronized. You can find more details in [their paper](https://www.cg.tuwien.ac.at/research/publications/2021/SCHUETZ-2021-PCC/)

The other really interesting piece to me about compute rasterizers is that you can use techniques that aren't possible with the traditional graphics pipeline. For example, to avoid jittering artifacts with so many millions of points, **they average the colors of all the points that fall on the same pixel**. This lets you visualize "volume" in some sense (think about a brown box with a red object inside, you'll get a bit of an x-ray like effect). This is possible because you can choose exactly how you want to combine the color you're about to write with the color the pixel currently has. Normally you don't get to be able to read & write at the same time to the buffer you're drawing to, or control how pixels blend in this free form way.

Another real world use case is in Unreal Engine 5, [where they switch to using a compute rasterizer for very small triangles](https://github.com/EpicGames/UnrealEngine/blob/ue5-early-access/Engine/Shaders/Private/Nanite/WritePixel.ush#L88-L94), since that can be much faster that way. 

So I decided to set up a basic compute shader rasterizer to make it easier for myself and others to explore this class of techniques. What other types of scenes could get a performance boost like this? 

And going beyond performance, **what other unique visualization/stylized techniques can this enable?** Below are a few ideas I explored while working on this guide.

(1) You can interpolate between smooth & flat shading within the same model. Here the triangles go from smooth to flat shading as they move across the screen:

https://user-images.githubusercontent.com/1711126/145685335-f91aac91-b4bc-4038-b159-bb3a66f19603.mp4

It's very interesting to be able to decide on a per-triangle basis what type of shading it should have, and could make for a really fun effect to have a model animate "turning flat", propagating the effect slowly across the model starting at one point.

(2) You can visualize the order that pixels are drawn in. Normally you never get to see this when rendering on the GPU, but with this compute shader renderer, you can keep count of how many pixels you've drawn so far with an atomic counter and stop rendering at an arbitrary limit, which will show you the order in which pixels are getting draw in.

https://user-images.githubusercontent.com/1711126/145685976-582dbf05-4e30-411a-9df9-a13e540cb3bc.mp4

(3) Instead of limiting the number of pixels drawn each frame, we can stop the triangle filling partway through at a specific % every frame to animate it. This creates a really fascinating "dissolve" effect.

https://user-images.githubusercontent.com/1711126/145686026-c854ce90-e3ef-4750-a8dd-fc9842641772.mp4


## Step 0 - Basic compute shader rendering

In this step we'll setup the starter code and walk through how it works. This will be a basic WebGPU scene where a compute pass fills a color buffer, and a render pass draws it to the screen. 

_Note: At this step there's nothing rasterization-specific about this code. It can be used as a starting template for any other compute-based rendering techniques, like ray tracing._

1. Clone or download the branch [step-0](https://github.com/OmarShehata/webgpu-compute-rasterizer/tree/step-0).
2. Run `npm install` and `npm run dev`
3. Open [http://localhost:3000/](http://localhost:3000/) in a browser that supports WebGPU.

You should see a black screen. 

4. Just to confirm everything is working, try changing the color to red by opening up `shaders/computeRasterizer.wgsl`. Change the first component in the `main` function to `255u`:

```wgsl
outputColorBuffer.values[index + 0u] = 255u;
```

It should automatically update when you save the file.

#### Overall structure

* `src/main.js` is the entry point.
* The `init` function sets up the WebGPU context and creates two passes:

```javascript
const { addComputePass, outputColorBuffer } = createComputePass(presentationSize, device);
const { addFullscreenPass } = createFullscreenPass(presentationFormat, device, presentationSize, outputColorBuffer);
```

* `addComputePass` and `addFullscreenPass` are called every frame to push their commands to the WebGPU command encoder.
* `addComputePass` will fill a storage buffer called `outputColorBuffer`.
* `addFullscreenPass` will take that storage buffer and draw its pixels to the screen.

#### The fullscreen pass

* Inside `createFullscreenPass` we create (1) the bind group & layout, (2) the render pipeline (3) the shader modules, and (4) the commands needed to draw to the screen.
* Both the vertex and fragment shaders are in `shaders/fullscreenQuad.wgsl`.
* The full screen quad shader code is adapted from this [WebGPU sample code](https://austin-eng.com/webgpu-samples/samples/imageBlur#../../shaders/fullscreenTexturedQuad.wgsl). It draws a fullscreen quad using two triangles whose vertices are harcoded in the vertex shader.
* To draw the pixels to the screen, we need to get the location of the current pixel. This is done using the built-in variable `position` in the fragment shader.
  * See [built in variables](https://www.w3.org/TR/WGSL/#builtin-variables) in the WGSL spec.
  * This is essentially the equivalent of `gl_Position` in OpenGL.
  * It's declared in the constructor for the fragment shader as shown below.

```wgsl
fn frag_main(@builtin(position) coord: vec4<f32>)
```

* Given the X and Y, we need to figure out what index to pull from our color buffer, which is just an array of RGB 32 bit unsigned values. I decided to store the pixels as rows, so the computation to get the index is as follows:

```wgsl
let X = floor(coord.x);
let Y = floor(coord.y);
let index = u32(X + Y * uniforms.screenWidth) * 3u;//Multiply by 3 because we have 3 components, RGB.

// finalColorBuffer.data[index + 0u] <---- this is the R value, which ranges from 0 to 255
```

#### The compute pass

* Inside `createComputePass` we create (1) the bind group & layout, (2) the compute pipeline, (3) the shader module, (4) the commands to dispatch the compute pass, and (5) the storage buffer that holds the pixel colors
* The color buffer `outputColorBuffer` has a size of `WIDTH * HEIGHT * 3`, since we have 3 components, R, G, B. 
* We store colors in as rows of pixels, interleaved. 
* We dispatch the compute pass once for every pixel. We're using the maximum workgroup size, 256, so the number of times to dispatch it is:

```javascript
const totalTimesToRun = Math.ceil((WIDTH * HEIGHT) / 256);
passEncoder.dispatch(totalTimesToRun);
```

* Note that this means it'll run more times than there are pixels, since we are rounding up. 
  * It may be beneficial to add a check to ensure those extra threads early return, but this didn't cause any issues for me.
* The compute program is in `shaders/computeRasterizer.wgsl`. It fills all the pixels with a single color.

For more on WebGPU compute shader basics, see https://web.dev/gpu-compute/.

#### Challenges

Here are are a few suggested exercises to make sure you understand how everything fits together:

* Turn half the screen a different color (horizontally or vertically). 
  * You'll need to use the `uniforms.screenWidth` and `uniforms.screenHeight` variables.
* Color just one line across the screen (horizontal or vertical) white.
* Switch the color buffer to columns of pixels instead of rows of pixels. 
  * This is the only challenge that requires changing `shaders/fullscreenQuad.wgsl`.

## Step 1 - Drawing triangles

In this step we'll create a vertex buffer to send to the compute shader, and draw those triangles. 

The final code for this step is in the branch `step-1`. You can see the full diff for this step [in this commit](https://github.com/OmarShehata/webgpu-compute-rasterizer/commit/00c6fc202664b679e9585107b88f1b90c2ea3d1b). 

1. Inside `createComputePass`, create a vertex buffer that contains data for one triangle in screen space, stored as X,Y,Z:

```javascript
const verticesArray = new Float32Array([ 
  200, 200, 10, 
  300, 200, 50,
  200, 300, 50
 ]);
const NUMBERS_PER_VERTEX = 3;
const vertexCount = verticesArray.length / NUMBERS_PER_VERTEX;
const verticesBuffer = device.createBuffer({
  size: verticesArray.byteLength,
  usage: GPUBufferUsage.STORAGE,
  mappedAtCreation: true,
});
new Float32Array(verticesBuffer.getMappedRange()).set(verticesArray);
verticesBuffer.unmap();
```

The vertex data is declared as a `Float32Array`. We create a storage buffer out of that (`usage: GPUBufferUsage.STORAGE`). We pass `mappedAtCreation: true` so that we can copy data from the CPU side to it. We call `unmap()` to copy the data to the GPU. It will no longer be accessible to the CPU after that. For more on WebGPU buffer data management, see [WebGPU buffer upload best practices](https://github.com/toji/webgpu-best-practices/blob/main/buffer-uploads.md).  

2. In the same function, add an entry to `bindGroupLayout` of type storage buffer, to tell it the type of buffer we're binding:

```javascript
{
  binding: 1,// I pushed the uniform buffer to "2", and made the vertices buffer "1" here. But it doesn't matter as long as this matches the number used in the shader code.
  visibility: GPUShaderStage.COMPUTE, 
  buffer: {
    type: "read-only-storage"
  }
},
```

3. And then add an entry to the `bindGroup`, to pass the actual data we're binding:

```javascript
{
  binding: 1,// Must be the same binding number you used above
  resource: {
    buffer: verticesBuffer
  }
},
```

4. Update the number of times we dispatch this shader to the number of vertices divided by 3 (since we want to run it once for each triangle):

```javascript
const totalTimesToRun = Math.ceil((vertexCount / 3) / 256);
```

5. Add a binding for the new vertex buffer to `shaders/computeRasterizer.wgsl`:

```wgsl
@group(0) binding(1) var<storage, read> vertexBuffer : VertexBuffer;
// Make sure to update uniforms to binding(2)
```

6. Declare the `VertexBuffer` type at the top of the file:

```wgsl
struct Vertex { x: f32, y: f32, z: f32, };

struct VertexBuffer {
  values: array<Vertex>,
};
```

7. Create a `color_pixel` helper function in `shaders/computeRasterizer.wgsl` to color an individual pixel given position & color:

```wgsl
fn color_pixel(x: u32, y: u32, r: u32, g: u32, b: u32) {
  let pixelID = u32(x + y * u32(uniforms.screenWidth)) * 3u;

  outputColorBuffer.values[pixelID + 0u] = r;
  outputColorBuffer.values[pixelID + 1u] = g;
  outputColorBuffer.values[pixelID + 2u] = b;
}
```

8. Update the `main` function to get 3 vertices, and draw each of them. The full main function should look as follows:

```wgsl
@stage(compute) workgroup_size(256, 1)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let index = global_id.x * 3u;

  let v1 = vertexBuffer.values[index + 0u];
  let v2 = vertexBuffer.values[index + 1u];
  let v3 = vertexBuffer.values[index + 2u];
  
  color_pixel(u32(v1.x), u32(v1.y), 255u, 0u, 0u);
  color_pixel(u32(v2.x), u32(v2.y), 255u, 0u, 0u);
  color_pixel(u32(v3.x), u32(v3.y), 255u, 0u, 0u);
}
```

At this point you should see the 3 points of the triangle colored in red.

![](https://user-images.githubusercontent.com/1711126/145724438-02d181af-faab-4454-b206-f042c8f03932.png)

Before we fill in the triangle, we'll make an intermediate step to draw lines to connect these points.

9. Create a `project` function. In the next step this will handle 3d perspective projection. For now we'll use this to convert the point types from a `Vertex` to a `vec3<f32>`.

```wgsl
fn project(v: Vertex) -> vec3<f32> {
  return vec3<f32>(v.x, v.y, v.z);
}
```

And then use it in `main`: 

```wgsl
let v1 = project(vertexBuffer.values[index + 0u]);
let v2 = project(vertexBuffer.values[index + 1u]);
let v3 = project(vertexBuffer.values[index + 2u]);
```

You should still see the same 3 red points at this step.

10. Create a `draw_line` helper function that loops across all pixels between two points and colors them:

```wgsl
fn draw_line(v1: vec3<f32>, v2: vec3<f32>) {
  let v1Vec = vec2<f32>(v1.x, v1.y);
  let v2Vec = vec2<f32>(v2.x, v2.y);

  let dist = i32(distance(v1Vec, v2Vec));
  for (var i = 0; i < dist; i = i + 1) {
    let x = u32(v1.x + f32(v2.x - v1.x) * (f32(i) / f32(dist)));
    let y = u32(v1.y + f32(v2.y - v1.y) * (f32(i) / f32(dist)));
    color_pixel(x, y, 255u, 255u, 255u);
  }
}
```

And use it in `main` instead of coloring the 3 points manually:

```wgsl
draw_line(v1, v2);
draw_line(v1, v3);
draw_line(v2, v3);
```

You should now see a triangle with an outline.

![](https://user-images.githubusercontent.com/1711126/145724635-07bd1e13-ffa3-4aa1-8b0f-b306a0403ff1.png)

#### Filling in the triangle

Finally, we are going to fill in this triangle. To do this, we are going to get the min/max of all 3 points, do a double for loop across all points in that grid, and color them only if they are inside the triangle. 

We will determine if a point is inside the triangle using barycentric coordinates. 

This technique is described in more detail in [Lesson 2 - Triangle rasterization and back face culling](https://github.com/ssloy/tinyrenderer/wiki/Lesson-2:-Triangle-rasterization-and-back-face-culling) from Dmitry V. Sokolov's Tiny Renderer project.

11. Copy the code below above `main`

```wgsl
// From: https://github.com/ssloy/tinyrenderer/wiki/Lesson-2:-Triangle-rasterization-and-back-face-culling
fn barycentric(v1: vec3<f32>, v2: vec3<f32>, v3: vec3<f32>, p: vec2<f32>) -> vec3<f32> {
  let u = cross(
    vec3<f32>(v3.x - v1.x, v2.x - v1.x, v1.x - p.x), 
    vec3<f32>(v3.y - v1.y, v2.y - v1.y, v1.y - p.y)
  );

  if (abs(u.z) < 1.0) {
    return vec3<f32>(-1.0, 1.0, 1.0);
  }

  return vec3<f32>(1.0 - (u.x+u.y)/u.z, u.y/u.z, u.x/u.z); 
}

fn get_min_max(v1: vec3<f32>, v2: vec3<f32>, v3: vec3<f32>) -> vec4<f32> {
  var min_max = vec4<f32>();
  min_max.x = min(min(v1.x, v2.x), v3.x);
  min_max.y = min(min(v1.y, v2.y), v3.y);
  min_max.z = max(max(v1.x, v2.x), v3.x);
  min_max.w = max(max(v1.y, v2.y), v3.y);

  return min_max;
}

fn draw_triangle(v1: vec3<f32>, v2: vec3<f32>, v3: vec3<f32>) {
  let min_max = get_min_max(v1, v2, v3);
  let startX = u32(min_max.x);
  let startY = u32(min_max.y);
  let endX = u32(min_max.z);
  let endY = u32(min_max.w);

  for (var x: u32 = startX; x <= endX; x = x + 1u) {
    for (var y: u32 = startY; y <= endY; y = y + 1u) {
      let bc = barycentric(v1, v2, v3, vec2<f32>(f32(x), f32(y))); 
      let color = bc.x * v1.z + bc.y * v2.z + bc.z * v3.z;

      let R = color;
      let G = color;
      let B = color;

      if (bc.x < 0.0 || bc.y < 0.0 || bc.z < 0.0) {
        continue;
      }
      color_pixel(x, y, u32(R), u32(G), u32(B));
    }
  }
}
```

And then use it in `main` instead of drawing the 3 lines:

```wgsl
draw_triangle(v1, v2, v3);
```

You should see a shaded triangle:

![](https://user-images.githubusercontent.com/1711126/145724800-4f4847b1-5250-4066-9391-26aaece67d0f.png)

The triangle is a gradient because we choose the color of the current pixel based on its z coordinate, which we determine by interpolating the z coordinate of the 3 vertices of the triangle. This is done in these 2 lines in the `draw_triangle` function:

```wgsl
let bc = barycentric(v1, v2, v3, vec2<f32>(f32(x), f32(y))); 
let color = bc.x * v1.z + bc.y * v2.z + bc.z * v3.z;
```

The triangle vertices are not all at the same `z` coordinate. If you go back to `main.js` and set the z coordinate for all the vertices to 50, the triangle will appear as a solid color:

```javascript
const verticesArray = new Float32Array([ 
  200, 200, 50, 
  300, 200, 50,
  200, 300, 50
 ]);
```

Right now the z coordinate doesn't actually represent anything in 3D, since are not yet doing any projection. We are just using it as a color value.

#### Challenges

* Add a 2nd triangle
* Draw an outline around the filled in triangle using `draw_line`
  * Note that the order of operations here matters

## Step 2 - 3D perspective projection

In this step we'll create a model view projection matrix and pass it to the compute shader. We'll change the vertex buffer to be in 3D world space, and transform to screen space in the shader. We'll also add a clear pass so we can animate our scene.

The final code for this step is in the branch `step-2`. You can see the full diff for this step [in this commit](https://github.com/OmarShehata/webgpu-compute-rasterizer/commit/e550979fe16f1b307211510b800f614001e1c4fe). 

1. Add the `gl-matrix` library, which we'll use to create the model view projection matrix:

```
npm install gl-matrix --save
``` 

And import it at the top of `main.js`:

```javascript
import { mat4, vec3, vec4 } from 'gl-matrix';
```

2. Extend the uniform buffer to have space for the 4x4 matrix:

```javascript
const UBOBufferSize = 
    4 * 2 +// screen width & height
    4 * 16 +// 4x4 matrix
    8 // required extra padding
```

The extra padding is required because of memory alignment requirements in WebGPU. See [discussion here](https://github.com/gpuweb/gpuweb/discussions/2348#discussioncomment-1708480) for more details.

3. Create the projection matrix before the `addComputePass` function:

```javascript
const aspect = WIDTH / HEIGHT;
const projectionMatrix = mat4.create();
mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 100.0);
```

4. Create the view and model matrices inside the `addComputePass` function. We create them here so that we can update/animate them over time later:

```javascript
const viewMatrix = mat4.create();
// Move the camera 
mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(5, 5, -20));
const modelViewProjectionMatrix = mat4.create();
const modelMatrix = mat4.create();
// Combine all into a modelViewProjection
mat4.multiply(viewMatrix, viewMatrix, modelMatrix);
mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);
```

5. Write the matrix into the uniforms before:

```javascript
device.queue.writeBuffer(UBOBuffer, 16, modelViewProjectionMatrix.buffer); 
```

We write it at index `16` again because of the memory alignment/padding. The width & height variables each take 4 bytes, then we have 8 bytes of padding. 

6. In `computeRasterizer.wgsl`, add the matrix to the uniforms:

```wgsl
struct UBO {
  screenWidth: f32,
  screenHeight: f32,
  modelViewProjectionMatrix: mat4x4<f32>,// <---- add this line
};
```

7. Update the `project` function to use the model view projection matrix:

```wgsl
fn project(v: Vertex) -> vec3<f32> {
  var screenPos = uniforms.modelViewProjectionMatrix * vec4<f32>(v.x, v.y, v.z, 1.0);
  screenPos.x = (screenPos.x / screenPos.w) * uniforms.screenWidth;
  screenPos.y = (screenPos.y / screenPos.w) * uniforms.screenHeight;

  return vec3<f32>(screenPos.x, screenPos.y, screenPos.w);
}
```

At this point the triangle will disappear. 

8. Update the triangle vertices so that they are in 3D world coordinates in `main.js`:

```javascript
const verticesArray = new Float32Array([ 
  -1, -1, 0, 
  -1, 1, 0,
  1, -1, 0
 ]);
```

The triangle should be back on screen.

9. We'll rotate the model by updating the model matrix. Insert these 2 lines right after the `modelMatrix = mat4.create()` line:

```javascript
const now = Date.now() / 1000;
mat4.rotate( modelMatrix, modelMatrix, now, vec3.fromValues(0, 0, 1) );
```

You should see the triangle rotating, but since there is no clear pass, it will smear as it does.

![](https://user-images.githubusercontent.com/1711126/145736717-37b24c9a-fa55-48b7-a13c-048ac917f50c.gif)

10. Add a clear pass by inserting a new entry point function into the same `computeRasterizer.wgsl` file:

```wgsl
@stage(compute) @workgroup_size(256, 1)
fn clear(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let index = global_id.x * 3u;

  outputColorBuffer.values[index + 0u] = 0u;
  outputColorBuffer.values[index + 1u] = 0u;
  outputColorBuffer.values[index + 2u] = 0u;
}
```

And create the pipeline for it, right under where the `rasterizerPipeline` is created:

```javascript
const clearPipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  compute: {  module: computeRasterizerModule, entryPoint: "clear" }
});
```

Note that we are using the same bind group layout for the rasterizer pass here, despite the fact that the clear pass only needs access to the color buffer, but not the vertices buffer. I'm not sure if this is the best practice vs creating a separate bind group/layout that only has the required data for this pass.

Finally, dispatch it for all pixels, before the rasterizer pass:

```javascript
/// ... after the code to write the uniform buffers

const passEncoder = commandEncoder.beginComputePass();
let totalTimesToRun = Math.ceil((WIDTH * HEIGHT) / 256);
// Clear pass
passEncoder.setPipeline(clearPipeline);
passEncoder.setBindGroup(0, bindGroup);
passEncoder.dispatch(totalTimesToRun);
// Rasterizer pass
totalTimesToRun = Math.ceil((vertexCount / 3) / 256);
passEncoder.setPipeline(rasterizerPipeline);
passEncoder.setBindGroup(0, bindGroup);
passEncoder.dispatch(totalTimesToRun);
```

You should now see a rotating triangle with no smearing. 

#### Challenges

* Try moving the camera from side to side over time
* Try rotating the triangle along another axis
* Try creating many triangles that are behind each other in the Z direction.
  * Since there's no depth sorting happening right now, we would expect to see some triangles that should be behind others rendered in front, depending on what order the pixels are drawn in.

## Step 3 - Load a glTF & correct depth rendering with atomics

In this final step we will load triangles from a simple glTF model, and then use atomic operations to ensure the triangles closest to the camera are rendered on top.

The final code for this step is in the branch `step-3`. You can see the full diff for this step [in this commit](https://github.com/OmarShehata/webgpu-compute-rasterizer/commit/0c5df56e8523856a42a7efda98e69300c848f264). 

1. Add the `gltf-transform` library which we'll use to load & parse a glTF model:

```
npm install @gltf-transform/core --save
```

2. Import the `loadModel` wrapper at the top of `main.js`:

```javascript
import { loadModel } from './loadModel.js';
```

This is a thin wrapper I wrote around `gltf-transform/core` that will load `models/suzanne.glb`, and extract the triangles using the index buffer defined in the glTF.

3. Load the model in the top level `init()` function, and update `createComputePass` to take in a vertices array:

```javascript
const verticesArray = await loadModel();
const { addComputePass, outputColorBuffer } = createComputePass(presentationSize, device, verticesArray);
```

And further below where `createComputePass` is defined, it should take in the new argument:

```javascript
function createComputePass(presentationSize, device, verticesArray) {
```

And then remove the hard-coded verticesArray we've been using so far so that the `verticesArray` given to this function is passed to the shader instead.

At this point you should see the Suzanne monkey head model rendered and rotating.

4. Rotate the model 90 degrees so it's facing the camera, and updating the rotation code so it rotates around the Y axis:

```javascript
mat4.rotate( modelMatrix, modelMatrix, now, vec3.fromValues(0, 1, 0) );
mat4.rotate( modelMatrix, modelMatrix, Math.PI/2, vec3.fromValues(1, 0, 0) );
```

It may not be very clear what's happening here, but the triangles are not rendered in the correct order. We'll make a few changes to make this a bit more clear.

5. Change the camera Z position to `-10` to bring the model a little closer:

```javascript
mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(5, 5, -10));
```
6. Inside `computeRasterizer.wgsl`, update the line the color is computed to scale it up to give it more contrast. This line is in the `draw_triangle` function, inside the double for loop:

```wgsl
let color = (bc.x * v1.z + bc.y * v2.z + bc.z * v3.z) * 50.0 - 400.0;
```

![](https://user-images.githubusercontent.com/1711126/145738107-0602de2b-0987-4155-bef7-e72427272317.gif)

We can fix this by sorting the triangles from back to front, but we would need to sort them after the projection happens. Instead, a better approach is to use a depth buffer.

Instead of adding a second storage buffer, to keep this simple, we'll just use the color itself. We want to only draw a pixel if its color is darker than the pixel we're about to overwrite. To do this without race conditions, we need a way to perform atomic operations.

7. Change the type of the `ColorBuffer` struct to be an array of atomic values:

```wgsl
struct ColorBuffer {
  values: array<atomic<u32>>,
};
```

8. Change the `color_pixel` function to only write a color value if it's less than the current pixel. We'll do this by using `atomicMin` which will choose the minimum value out of all the threads that are trying to write something to the current memory location:

```wgsl
fn color_pixel(x: u32, y: u32, r: u32, g: u32, b: u32) {
  let pixelID = u32(x + y * u32(uniforms.screenWidth)) * 3u;

  atomicMin(&outputColorBuffer.values[pixelID + 0u], r);
  atomicMin(&outputColorBuffer.values[pixelID + 1u], g);
  atomicMin(&outputColorBuffer.values[pixelID + 2u], b);
}
```

9. Since we are now reading & writing to the color buffer at the same time, we need to update how we declared the color buffer to be `var<storage, write>` instead of `var<storage, read_write>`:

```wgsl
@group(0) binding(0) var<storage, read_write> outputColorBuffer : ColorBuffer;
```

10. We need to update anywhere else we are setting values in `outputColorBuffer` to use atomics. So change the clear pass to:

```wgsl
atomicStore(&outputColorBuffer.values[index + 0u], 255u);
atomicStore(&outputColorBuffer.values[index + 1u], 255u);
atomicStore(&outputColorBuffer.values[index + 2u], 255u);
```

We also change it to white here so that the background color is greater than any of the triangles we are drawing, to allow them to pass the `atomicMin` check in `color_pixel`.

That's it! 🎉

#### Challenges

* Try rendering the model with flat shading instead of smooth shading
  * This will require a change in the `draw_triangle` function
* Try animating smooth to flat shading over time
  * You'll need to pass an extra uniform to the shader that holds a time value

## Thanks for reading!

If you found this useful, please share it! You can find me on Twitter at [@omar4ur](https://twitter.com/Omar4ur) or on [my website](https://omarshehata.me/). If you have any suggestions or see anything that needs fixing, contributions are welcome.

There are many directions you can go from here, such as:

* Adding an actual depth buffer so that you can draw models with arbitrary colors at the correct depth
* Extending the `loadModel` function to support more complex glTF models, and using an index buffer to support models with more triangles while lowering memory consumption
* Explore a completely different compute-based rendering technique, like point cloud rendering or ray tracing

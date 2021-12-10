# How to Build a Compute Rasterizer with WebGPU

Outline:

* This is a step by step guide to build a rasterizer using compute shaders with WebGPU. This is a great first "significant" project with WebGPU or if you're interested in exploring compute based rendering techniques. 
	!! TODO how many steps to expect etc? I'll know when it's done
* Background & motivation - why compute based?
  * See point cloud optimization paper. See this WebGPU video. There is also some body of research (links?)
  * It's also a great learning exercise, following TinyRenderer. But you're still doing it on the GPU. It's really cool to be able to inspect what's going on.
  	!! For example, I can pass a uniform to interrupt filling in triangles to "watch" the rasterization process
  	!! A more interesting experiment is to use atomics to stop after coloring X pixels. See these two gifs. (1) coloring them all at the same time. and (2) coloring them from right to left, because of a smaller work group size.
* Step 0 - basic compute setup

Here we're just going to do the minimal setup, where we have a compute shader that fills in a buffer of pixels with a solid color, and that is then rendered.

Challenges: color one column or row? Color half the screen. Extra challenge: color a circle. 

* Step 1 - Drawing triangles

We're going to pass in a vertex buffer. We're going to run the rasterizer pass, we're going to draw lines. Followed by filling in the triangles, with barycentric, and with depth. 

* Step 2 - Loading a model & model view projection 

Load a model, they're in world space now. Set up MVP matrix. Pass it to shader. Do projection. 

* Step 3 - Using atomics for correct depth rendering

Switch to using atomics. 
[[block]] struct ColorBuffer {
  values: array<u32>;
};

struct Vertex { x: f32; y: f32; z: f32; r: f32; g: f32; b: f32; };

[[block]] struct VertexBuffer {
  values: array<Vertex>;
};

[[block]] struct UBO {
  screenWidth: f32;
  screenHeight: f32;
  vertexCount: f32;
  modelViewProjectionMatrix: mat4x4<f32>;
};

[[group(0), binding(0)]] var<storage, write> outputColorBuffer : ColorBuffer;
[[group(0), binding(1)]] var<storage, read> vertexBuffer : VertexBuffer;
[[group(0), binding(2)]] var<uniform> uniforms : UBO;

///////////////////////////////////////////////////// Helper functions
fn get_min_max(v1: vec2<f32>, v2: vec2<f32>, v3: vec2<f32>) -> vec4<f32> {
  var min_max = vec4<f32>();

  min_max.x = min(min(v1.x, v2.x), v3.x);
  min_max.y = min(min(v1.x, v2.y), v3.y);

  min_max.z = max(max(v1.x, v2.x), v3.x);
  min_max.w = max(max(v1.x, v2.y), v3.y);

  return min_max;
}

fn color_pixel(x: u32, y: u32, r: u32, g: u32, b: u32) {
  //let x = nx * u32(uniforms.screenWidth);
  //let y = ny * u32(uniforms.screenHeight);

  let pixelID = u32(x + y * u32(uniforms.screenWidth)) * 3u;
  
  outputColorBuffer.values[pixelID + 0u] = r;
  outputColorBuffer.values[pixelID + 1u] = g;
  outputColorBuffer.values[pixelID + 2u] = b;
}

// From: https://github.com/ssloy/tinyrenderer/wiki/Lesson-2:-Triangle-rasterization-and-back-face-culling
fn barycentric(v1: vec2<f32>, v2: vec2<f32>, v3: vec2<f32>, p: vec2<f32>) -> vec3<f32> {
  let u = cross(
    vec3<f32>(v3.x - v1.x, v2.x - v1.x, v1.x - p.x), 
    vec3<f32>(v3.y - v1.y, v2.y - v1.y, v1.y - p.y)
  );

  if (abs(u.z) < 1.0) {
    return vec3<f32>(-1.0, 1.0, 1.0);
  }

  return vec3<f32>(1.0 - (u.x+u.y)/u.z, u.y/u.z, u.x/u.z); 
}

fn draw_triangle(v1: vec2<f32>, v2: vec2<f32>, v3: vec2<f32>, color: vec3<f32>) {
  let min_max = get_min_max(v1, v2, v3);
  let startX = u32(min_max.x);
  let startY = u32(min_max.y);
  let endX = u32(min_max.z);
  let endY = u32(min_max.w);

  for (var x: u32 = startX; x < endX; x = x + 1u) {
    for (var y: u32 = startY; y < endY; y = y + 1u) {
      let bc = barycentric(v1, v2, v3, vec2<f32>(f32(x), f32(y))); 
      if (bc.x < 0.0 || bc.y < 0.0 || bc.z < 0.0) {
        continue;
      }
      color_pixel(x, y, u32(color.r), u32(color.g), u32(color.b));
    }
  }
}

// Given vertex in world coordinate, return it in screen coordinates
fn project(v: Vertex) -> vec2<f32> {
    var screenPos = uniforms.modelViewProjectionMatrix * vec4<f32>(v.x, v.y, v.z, 1.0);
    screenPos.x = (screenPos.x / screenPos.w) * uniforms.screenWidth;
    screenPos.y = (screenPos.y / screenPos.w) * uniforms.screenHeight;

    return vec2<f32>(screenPos.x, screenPos.y);
}

fn is_off_screen(v: vec2<f32>) -> bool {
  if (v.x < 0.0 || v.x > uniforms.screenWidth || v.y < 0.0 || v.y > uniforms.screenHeight) {
    return true;
  }

  return false;
}

///////////////////////////////////////////////////// End Helper functions


[[stage(compute), workgroup_size(256, 1)]]
fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
  let index = global_id.x * 3u;
  // The compute shader may run for more iterations than we have vertices
  // so we early exit here if we've run out of vertices
  if (index >= u32(uniforms.vertexCount)) {
    return;
  }

  let v1World = vertexBuffer.values[index + 0u];
  let v2World = vertexBuffer.values[index + 1u];
  let v3World = vertexBuffer.values[index + 2u];

  // Transform vertices by modelViewProjection
  let v1 = project(v1World);
  let v2 = project(v2World);
  let v3 = project(v3World);

  // Discard if any points are offscreen 
  if (is_off_screen(v1) || is_off_screen(v2) || is_off_screen(v3)) {
    //return;
  }

  draw_triangle(v1, v2, v3, vec3<f32>(v1World.r, v1World.g, v1World.b));  
}

[[stage(compute), workgroup_size(256, 1)]]
fn clear([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
  let index = global_id.x * 3u;

  outputColorBuffer.values[index + 0u] = 0u;
  outputColorBuffer.values[index + 1u] = 0u;
  outputColorBuffer.values[index + 2u] = 0u;
}
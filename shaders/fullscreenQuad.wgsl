[[block]] struct ColorData {
  data : array<u32>;
};

[[block]] struct Uniforms {
  screenWidth: f32;
  screenHeight: f32;
};

[[group(0), binding(0)]] var<uniform> uniforms : Uniforms;
[[group(0), binding(1)]] var<storage, read> finalColorBuffer : ColorData;

struct VertexOutput {
  [[builtin(position)]] Position : vec4<f32>;
};

[[stage(vertex)]]
fn vert_main([[builtin(vertex_index)]] VertexIndex : u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
      vec2<f32>( 1.0,  1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>(-1.0, -1.0),
      vec2<f32>( 1.0,  1.0),
      vec2<f32>(-1.0, -1.0),
      vec2<f32>(-1.0,  1.0));

  var output : VertexOutput;
  output.Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  return output;
}

[[stage(fragment)]]
fn frag_main([[builtin(position)]] coord: vec4<f32>) -> [[location(0)]] vec4<f32> {
  let X = floor(coord.x);
  let Y = floor(coord.y);
  let index = u32(X + Y * uniforms.screenWidth) * 3u;

  let R = f32(finalColorBuffer.data[index + 0u]) / 255.0;
  let G = f32(finalColorBuffer.data[index + 1u]) / 255.0;
  let B = f32(finalColorBuffer.data[index + 2u]) / 255.0;

  let finalColor = vec4<f32>(R, G, B, 1.0);
  return finalColor;
}

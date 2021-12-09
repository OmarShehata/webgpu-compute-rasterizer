[[block]] struct ColorData {
  data : array<u32>;
};

[[block]] struct Uniforms {
  screenWidth: u32;
  screenHeight: u32;
};

[[binding(0), group(0)]] var<uniform> uniforms : Uniforms;
[[binding(1), group(0)]] var<storage, read> finalColorBuffer : ColorData;

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
  let index = (u32(coord.x) + u32(coord.y) * uniforms.screenWidth) * 3u + 1u;

  let R = f32(finalColorBuffer.data[index + 0u]) / 255.0;
  let G = f32(finalColorBuffer.data[index + 1u]) / 255.0;
  let B = f32(finalColorBuffer.data[index + 2u]) / 255.0;

  let finalColor = vec4<f32>(R, G, B, 1.0);
  return finalColor;
}

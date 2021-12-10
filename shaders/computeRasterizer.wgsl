[[block]] struct ColorBuffer {
  values: array<u32>;
};

[[block]] struct UBO {
  screenWidth: f32;
  screenHeight: f32;
};

[[group(0), binding(0)]] var<storage, write> outputColorBuffer : ColorBuffer;
[[group(0), binding(1)]] var<uniform> uniforms : UBO;

[[stage(compute), workgroup_size(256, 1)]]
fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
  let index = global_id.x * 3u;

  outputColorBuffer.values[index + 0u] = 0u;
  outputColorBuffer.values[index + 1u] = 0u;
  outputColorBuffer.values[index + 2u] = 0u;
}
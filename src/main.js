import { mat4, vec3, vec4 } from 'gl-matrix';
import '../style.css'
import fullscreenQuadWGSL from '../shaders/fullscreenQuad.wgsl?raw';
import computeRasterizerWGSL from '../shaders/computeRasterizer.wgsl?raw';
import { loadModel } from './loadModel.js';

init();

const queryLabelMap = {}
let printedTimestamps = false;

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const maxNumberOfQueries = 3;
  const querySet = device.createQuerySet({
    type: "timestamp",
    count: maxNumberOfQueries,
  });
  const queryBuffer = device.createBuffer({
    size: 8 * maxNumberOfQueries,
    usage: GPUBufferUsage.QUERY_RESOLVE 
      | GPUBufferUsage.STORAGE
      | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST,
  });

  const devicePixelRatio = window.devicePixelRatio || 1;
  const presentationSize = [
    Math.floor(canvas.clientWidth * devicePixelRatio),
    Math.floor(canvas.clientHeight * devicePixelRatio),
  ];

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "opaque"
  });

  const verticesArray = await loadModel();

  const { addComputePass, outputColorBuffer } = createComputePass(presentationSize, device, verticesArray);
  const { addFullscreenPass } = createFullscreenPass(presentationFormat, device, presentationSize, outputColorBuffer);

  let queryIndex = 0;
  function timestamp(encoder, label) {
    encoder.writeTimestamp(querySet, queryIndex);
    queryLabelMap[queryIndex] = label
    queryIndex++;
    if (queryIndex >= maxNumberOfQueries) queryIndex = 0;
  }

  async function draw() {
    const commandEncoder = device.createCommandEncoder();

    timestamp(commandEncoder);
    addComputePass(commandEncoder); 
    timestamp(commandEncoder, "compute pass")
    addFullscreenPass(context, commandEncoder);
    timestamp(commandEncoder, "fullscreen pass")

    commandEncoder.resolveQuerySet(
      querySet, 
      0,// first query index 
      maxNumberOfQueries, 
      queryBuffer, 
      0);// destination offset

    device.queue.submit([commandEncoder.finish()]);

    // Print just once for readability
    if (!printedTimestamps) {
      // Read the storage buffer data
      const arrayBuffer = await readBuffer(device, queryBuffer);
      // Decode it into an array of timestamps in nanoseconds
      const timingsNanoseconds = new BigInt64Array(arrayBuffer);
      // Print the diff's with labels
      printTimestampsWithLabels(timingsNanoseconds, queryLabelMap)
      
      printedTimestamps = true;
    }

    requestAnimationFrame(draw);
  }

  draw();
}

function createFullscreenPass(presentationFormat, device, presentationSize, finalColorBuffer) {
  const fullscreenQuadBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform"
        }
      }, 
      {
        binding: 1,// the color buffer
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "read-only-storage"
        }
      }
    ]
  });

  const fullscreenQuadPipeline = device.createRenderPipeline({
    layout:  device.createPipelineLayout({
        bindGroupLayouts: [fullscreenQuadBindGroupLayout]
      }),
    vertex: {
      module: device.createShaderModule({
        code: fullscreenQuadWGSL,
      }),
      entryPoint: 'vert_main',
    },
    fragment: {
      module: device.createShaderModule({
        code: fullscreenQuadWGSL,
      }),
      entryPoint: 'frag_main',
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const uniformBufferSize = 4 * 2; // screen width & height
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const fullscreenQuadBindGroup = device.createBindGroup({
    layout: fullscreenQuadBindGroupLayout,
    entries: [
      {
        binding: 0, 
        resource: {
          buffer: uniformBuffer
        }
      },
      {
        binding: 1, 
        resource: {
          buffer: finalColorBuffer
        }
      }
    ],
  });

  const renderPassDescriptor = {
    colorAttachments: [
      {
        view: undefined, // Assigned later

        clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ]
  };

  const addFullscreenPass = (context, commandEncoder) => {
     device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([presentationSize[0], presentationSize[1]]));

     renderPassDescriptor.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(fullscreenQuadPipeline);
      passEncoder.setBindGroup(0, fullscreenQuadBindGroup);
      passEncoder.draw(6, 1, 0, 0);
      passEncoder.end();
  }

  return { addFullscreenPass };
}

function createComputePass(presentationSize, device, verticesArray) {
  const WIDTH = presentationSize[0];
  const HEIGHT = presentationSize[1];
  const COLOR_CHANNELS = 3;

  const NUMBERS_PER_VERTEX = 3;
  const vertexCount = verticesArray.length / NUMBERS_PER_VERTEX;
  const verticesBuffer = device.createBuffer({
    size: verticesArray.byteLength,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  new Float32Array(verticesBuffer.getMappedRange()).set(verticesArray);
  verticesBuffer.unmap();

  const outputColorBufferSize = Uint32Array.BYTES_PER_ELEMENT * (WIDTH * HEIGHT) * COLOR_CHANNELS;
  const outputColorBuffer = device.createBuffer({
    size: outputColorBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });

  const UBOBufferSize =
    4 * 2  + // screen width & height
    4 * 16 + // 4x4 matrix
    8 // extra padding for alignment
  const UBOBuffer = device.createBuffer({
    size: UBOBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE, 
        buffer: {
          type: "storage"
        }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE, 
        buffer: {
          type: "read-only-storage"
        }
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "uniform",
        },
      }
    ]
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: outputColorBuffer
        }
      },
      {
        binding: 1,
        resource: {
          buffer: verticesBuffer
        }
      },
      {
        binding: 2, 
        resource: {
          buffer: UBOBuffer
        }
      }
    ]
  });

  const computeRasterizerModule = device.createShaderModule({  code: computeRasterizerWGSL });
  const rasterizerPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {  module: computeRasterizerModule, entryPoint: "main" }
  });
  const clearPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {  module: computeRasterizerModule, entryPoint: "clear" }
  });

  const aspect = WIDTH / HEIGHT;
  const projectionMatrix = mat4.create();
  mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 100.0);

  const addComputePass = (commandEncoder) => {
    // Compute model view projection matrix
    const viewMatrix = mat4.create();
    const now = Date.now() / 1000;
    // Move the camera 
    mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(4, 3, -10));
    const modelViewProjectionMatrix = mat4.create();
    const modelMatrix = mat4.create();
    // Rotate model over time
    mat4.rotate( modelMatrix, modelMatrix, now, vec3.fromValues(0, 1, 0) );
    // Rotate model 90 degrees so that it is upright
    mat4.rotate( modelMatrix, modelMatrix, Math.PI/2, vec3.fromValues(1, 0, 0) );
    // Combine all into a modelViewProjection
    mat4.multiply(viewMatrix, viewMatrix, modelMatrix);
    mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

    // Write values to uniform buffer object
    const uniformData = [WIDTH, HEIGHT];
    const uniformTypedArray = new Float32Array(uniformData);
    device.queue.writeBuffer(UBOBuffer, 0, uniformTypedArray.buffer);
    device.queue.writeBuffer(UBOBuffer, 16, modelViewProjectionMatrix.buffer);

    const passEncoder = commandEncoder.beginComputePass();
    let totalTimesToRun = Math.ceil((WIDTH * HEIGHT) / 256);
    // Clear pass
    passEncoder.setPipeline(clearPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(totalTimesToRun);
    // Rasterizer pass
    totalTimesToRun = Math.ceil((vertexCount / 3) / 256);
    passEncoder.setPipeline(rasterizerPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(totalTimesToRun);

    passEncoder.end();
  }

  return { addComputePass, outputColorBuffer };
}

async function readBuffer(device, buffer) {
  const size = buffer.size;
  // Get a GPU buffer for reading in an unmapped state.
  const gpuReadBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });

  const copyEncoder = device.createCommandEncoder();
  copyEncoder.copyBufferToBuffer(
    buffer /* source buffer */,
    0 /* source offset */,
    gpuReadBuffer /* destination buffer */,
    0 /* destination offset */,
    size /* size */
  );

  // Submit copy commands.
  const copyCommands = copyEncoder.finish();
  device.queue.submit([copyCommands]);

  await gpuReadBuffer.mapAsync(GPUMapMode.READ);
  return gpuReadBuffer.getMappedRange();
}

function printTimestampsWithLabels(timingsNanoseconds, labelMap) {
  console.log("==========")
  // Convert list of nanosecond timestamps to diffs in milliseconds
  const timeDiffs = []
  for (let i = 1; i < timingsNanoseconds.length; i++) {
    let diff = Number(timingsNanoseconds[i] - timingsNanoseconds[i - 1])
    diff /= 1_000_000
    timeDiffs.push(diff)
  }

  // Print each diff with its associated label
  for (let i = 0; i < timeDiffs.length; i++) {
    const time = timeDiffs[i];
    const label = labelMap[i + 1]
    if (label) {
      console.log(label, time.toFixed(2) + "ms")
    } else {
      console.log(i, time.toFixed(2) + "ms")
    }
  }
  console.log("==========")
}
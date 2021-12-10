import '../style.css'
import fullscreenQuadWGSL from '../shaders/fullscreenQuad.wgsl?raw';
import computeRasterizerWGSL from '../shaders/computeRasterizer.wgsl?raw';

init();

async function init() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const devicePixelRatio = window.devicePixelRatio || 1;
  const presentationSize = [
    Math.floor(canvas.clientWidth * devicePixelRatio),
    Math.floor(canvas.clientHeight * devicePixelRatio),
  ];

  const presentationFormat = context.getPreferredFormat(adapter);
  context.configure({
    device,
    format: presentationFormat,
    size: presentationSize,
  });

  const { addComputePass, outputColorBuffer } = createComputePass(presentationSize, device);
  const { addFullscreenPass } = createFullscreenPass(presentationFormat, device, presentationSize, outputColorBuffer);

  function draw() {
    const commandEncoder = device.createCommandEncoder();

    addComputePass(commandEncoder);
    addFullscreenPass(context, commandEncoder);

    device.queue.submit([commandEncoder.finish()]);

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
          type: "storage"
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

        loadValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
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
      passEncoder.endPass();
  }

  return { addFullscreenPass };
}

function createComputePass(presentationSize, device) {
  const WIDTH = presentationSize[0];
  const HEIGHT = presentationSize[1];
  const COLOR_CHANNELS = 3;

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

  const outputColorBufferSize = Uint32Array.BYTES_PER_ELEMENT * (WIDTH * HEIGHT) * COLOR_CHANNELS;
  const outputColorBuffer = device.createBuffer({
    size: outputColorBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });

  const UBOBufferSize = 4 * 2;// screen width & height
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
          type: "storage"
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

  const addComputePass = (commandEncoder) => {
    // Write values to uniform buffer object
    const uniformData = [WIDTH, HEIGHT];
    const uniformTypedArray = new Float32Array(uniformData);
    device.queue.writeBuffer(UBOBuffer, 0, uniformTypedArray.buffer);

    const passEncoder = commandEncoder.beginComputePass();
    const totalTimesToRun = Math.ceil((vertexCount / 3) / 256);
    
    passEncoder.setPipeline(rasterizerPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatch(totalTimesToRun);

    passEncoder.endPass();
  }

  return { addComputePass, outputColorBuffer };
}

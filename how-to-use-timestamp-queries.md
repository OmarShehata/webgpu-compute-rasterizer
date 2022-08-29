# How to use Timestamp Queries 

This tutorial covers how to use WebGPU's [timestamp query](https://www.w3.org/TR/webgpu/#dom-gpufeaturename-timestamp-query) to measure how much time your GPU commands take to execute.

Timestamp queries are an optional WebGPU feature and may not be supported in all implementations. At the time of writing it is currently disabled in browsers for security reasons ([see discussion here](https://github.com/gpuweb/gpuweb/issues/2218)). 

![](https://user-images.githubusercontent.com/1711126/187168810-f8f18320-91db-41ec-be77-20dcaf851b52.png)

## Summary

Below is a summary of the workflow for using timestamp queries:

1. Request access to `timestamp-query` when initializing the device
2. Create a query set with capacity `N` (number of timestamps you want to store in a frame)
3. Create a storage buffer with size `N * 8`. This is where the timestamp results are stored in nanoseconds, 64 bit numbers.
4. Record timestamps by calling [commandEncoder.writeTimestamp](https://www.w3.org/TR/webgpu/#dom-gpucommandencoder-writetimestamp). This will record a timestamp after all previous commands have finished. 
5. Call [commandEncoder.resolveQuerySet](https://www.w3.org/TR/webgpu/#dom-gpucommandencoder-resolvequeryset) to write the recorded timestamps to the storage buffer
6. Copy the results from the storage buffer to the CPU and decode them as a BigInt64Array (see [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt))

Example: you want to measure how long it takes to render all transparent objects in your scene. You would write 1 timestamp **before** any transparent draw calls, then a 2nd timestamp **after** all the transparent draw calls, then compute the difference. 

## Step by step guide

A full example implementation can be found in this PR: https://github.com/OmarShehata/webgpu-compute-rasterizer/pull/5/files

### 0 - Enable timestamp queries

Launch Chrome with the following command line flag:

```
--disable-dawn-features=disallow_unsafe_apis
```

### 1 - Queryset & buffer setup

First we add `timestamp-query` to the list of required features when requesting the device:

```javascript
const device = await adapter.requestDevice({
	requiredFeatures: ["timestamp-query"],
});
```

This will throw with the following error if it's not enabled/supported:

```
Uncaught (in promise) TypeError: Failed to execute 'requestDevice' on 'GPUAdapter': Unsupported feature: timestamp-query
```

Then we create a query set and a query buffer:

```javascript
const capacity = 3;//Max number of timestamps we can store
const querySet = device.createQuerySet({
	type: "timestamp",
	count: capacity,
});
const queryBuffer = device.createBuffer({
	size: 8 * capacity,
	usage: GPUBufferUsage.QUERY_RESOLVE 
	  | GPUBufferUsage.STORAGE
	  | GPUBufferUsage.COPY_SRC
	  | GPUBufferUsage.COPY_DST,
});
```

### 2 - Write timestamps

We call [commandEncoder.writeTimestamp(querySet, index)](https://www.w3.org/TR/webgpu/#dom-gpucommandencoder-writetimestamp) at any point in the pipeline where we want to record a timestamp:

```javascript
// Add timestamps in between GPU commands
commandEncoder.writeTimestamp(querySet, 0);// Initial timestamp
// commandEncoder.draw(...)
commandEncoder.writeTimestamp(querySet, 1);
```

The index must be less than or equal to `capacity - 1` that we defined earlier.

### 3 - Resolve timestamps to buffer

At the end of your frame, call [commandEncoder.resolveQuerySet](https://www.w3.org/TR/webgpu/#dom-gpucommandencoder-resolvequeryset) to actually write the timestamps to the storage buffer:

```javascript
commandEncoder.resolveQuerySet(
	querySet, 
	0,// index of first query to resolve 
	capacity,//number of queries to resolve
	queryBuffer, 
	0);// destination offset
```

### 4 - Read the results

To get the timestamp results we need to copy the `queryBuffer` data to the CPU. Reading from a WebGPU buffer is explained in more detail here: https://web.dev/gpu-compute/#commands-submission.

Once you have the buffer data, you decode it as a [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) typed array. The timestamps are recorded in nanoseconds.

```javascript
// === After `commandEncoder.finish()` is called ===
// Read the storage buffer data
const arrayBuffer = await readBuffer(device, queryBuffer);
// Decode it into an array of timestamps in nanoseconds
const timingsNanoseconds = new BigInt64Array(arrayBuffer);

// ....

async function readBuffer(device, buffer) {
  const size = buffer.size;
  const gpuReadBuffer = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const copyEncoder = device.createCommandEncoder();
  copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);

  const copyCommands = copyEncoder.finish();
  device.queue.submit([copyCommands]);

  await gpuReadBuffer.mapAsync(GPUMapMode.READ);
  return gpuReadBuffer.getMappedRange();
}
```

### (Optional) 5 - Create labels

To make the output more useful, we can define labels for each timestamp we collect, and then print out the diff so we can see the time it took for each step in our pipeline. It may also be useful to convert the result to milliseconds. 

This is implemented in the reference example here: https://github.com/OmarShehata/webgpu-compute-rasterizer/pull/5/files.

-----

_Big thanks to Markus Schütz whose [Potree implementation WebGPU implementation](https://github.com/m-schuetz/Potree2/blob/299b22ef59bb1eaebc8862d37ac86ae8800d5b6a/src/renderer/Timer.js) provided a great example of how to use timestamp queries. [Thanks to Yang Gu](https://github.com/gpuweb/gpuweb/discussions/3354) for explaining how to enable it in Chrome._

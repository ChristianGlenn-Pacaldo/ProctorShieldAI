// face-api's unbundled entry imports the tfjs meta-package. Keep its shared
// core engine, tensor methods and backends without the unused CLI/data/layers.
// Chained ops evaluate DEBUG while their modules load. Initialize the engine,
// flags, browser platform and tensor handler before registering those ops;
// a re-export alone can be evaluated later by production chunk loaders.
import "@tensorflow/tfjs-core/dist/base_side_effects";
import "@tensorflow/tfjs-core/dist/register_all_gradients";
import "@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops";

export * from "@tensorflow/tfjs-core";
export * from "@tensorflow/tfjs-backend-cpu";
export * from "@tensorflow/tfjs-backend-webgl";

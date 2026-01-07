declare module "mapbox-gl/dist/mapbox-gl-csp" {
  export * from "mapbox-gl";
  export { default } from "mapbox-gl";
}

declare module "mapbox-gl/dist/mapbox-gl-csp-worker" {
  const workerClass: any;
  export default workerClass;
}

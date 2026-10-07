import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserDeviceCapabilities, normalizeDeviceCapabilities, getMonitoringLevel, getProctoringPerformanceProfile } from "../src/lib/device-capabilities.ts";
function browser(t:any,userAgent:string,platform:string,maxTouchPoints=0,width=390){for(const[name,value]of Object.entries({navigator:{userAgent,platform,maxTouchPoints,mediaDevices:{getUserMedia(){}}},window:{innerWidth:width,innerHeight:600,isSecureContext:true}})){const old=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>{if(old)Object.defineProperty(globalThis,name,old);else delete(globalThis as any)[name];});}}
for(const [ua,platform]of [["Mozilla/5.0 (Windows NT 10.0; Win64; x64)","Win32"],["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)","MacIntel"],["Mozilla/5.0 (X11; Linux x86_64)","Linux x86_64"]])test(`${platform} narrow desktop stays desktop client and server`,t=>{
 browser(t,ua,platform,platform==="Win32"?10:0);assert.equal(getBrowserDeviceCapabilities().deviceType,"desktop");
 assert.equal(normalizeDeviceCapabilities({deviceType:"mobile",viewportWidth:390},ua).deviceType,"desktop");
});
for(const [ua,platform,touches]of [["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)","iPad",5],["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari", "MacIntel",5],["Mozilla/5.0 (Linux; Android 14; SM-X200)","Linux armv8l",5]] as const)test(`${platform} confident tablet classification survives normalization`,t=>{
 browser(t,ua,platform,Number(touches),1024);const caps=getBrowserDeviceCapabilities();assert.equal(caps.deviceType,"tablet");assert.equal(normalizeDeviceCapabilities(caps,ua).deviceType,"tablet");assert.equal(getMonitoringLevel(caps),"unsupported");
 assert.equal(getProctoringPerformanceProfile(caps.deviceType).useTinyLandmarks,true);
});
for(const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile","Mozilla/5.0 (Linux; Android 15; Pixel) Mobile"])test("phone monitoring classification is preserved independently of viewport",t=>{
 browser(t,ua,"",5,1800);const caps=getBrowserDeviceCapabilities();assert.equal(caps.deviceType,"mobile");assert.equal(normalizeDeviceCapabilities(caps,ua).deviceType,"mobile");
});

// This file is included by the index.html file and will be executed in the renderer process for that window.
console.log('renderer.js loaded');

// Browser friendly type-only imports as we can assume the electron app has these types loaded already.
type IpcRenderer = import('electron').IpcRenderer;

import { createApiClient } from '@gnaudio/jabra-electron-renderer-helper';
import { enumDeviceBtnType, DeviceType, JabraType, ClassEntry, JabraEventsList, DeviceEventsList, enumHidState, MethodEntry, enumFirmwareEventType, enumFirmwareEventStatus, PairedListInfo, enumUploadEventStatus, ParameterEntry } from '@gnaudio/jabra-node-sdk';

import { player, initSDKBtn, unInitSDKBtn, initStaticVersionInfo, checkInstallBtn, notyf, showError, setupDevices, toggleScrollMessageAreaBtn, 
         toggleScrollErrorAreaBtn, devicesBtn, setupUserMediaPlaybackBtn, deviceSelector, clearMessageAreaBtn, clearErrorAreaBtn, messageArea, errorArea, 
         messagesCount, errorsCount, messageFilter, copyMessagesBtn, methodSelector, param1Hint, param2Hint, param3Hint, param4Hint, param5Hint, 
         methodHelp, txtParam1, txtParam2, txtParam3, txtParam4, txtParam5, nativeSdkVersion, nativeSdkVersionContainer, apiClassSelector, setupApiClasses, 
         addDevice, removeDevice, setupApiMethods, invokeApiBtn, apiReferenceBtn, methodSignature, stressInvokeApiBtn, showInternalsAndDeprecatedMethodsChk } from './guihelper';
import { BoundedQueue } from './queue';
import { nameof } from '../common/util';
import { openHelpWindow } from '../common/ipc';

const stressWaitInterval = 1000;
const maxQueueSize = 1000;

let variables = {
  audioElement: player,
  mediaStream: undefined,
  deviceInfo: undefined
}
  
let boomArm = undefined;
let txDb = undefined;
let txPeakDb = undefined;
let rxDb = undefined;
let rxPeakDb = undefined;
let rxSpeech = undefined;
let txSpeech = undefined;

let scrollMessageArea = true;
let scrollErrorArea = true;
// let scrollLogArea = true;

let errors = new BoundedQueue<string>(maxQueueSize);
let messages = new BoundedQueue<string>(maxQueueSize);
// let logs = new BoundedQueue<string>(maxQueueSize);

let stressInvokeCount: number | undefined = undefined;
let stressInterval: NodeJS.Timeout | undefined = undefined;

initStaticVersionInfo();

let jabra: JabraType | undefined = undefined;

initSDKBtn.onclick = () => {
    let response = createApiClient(window.electron.ipcRenderer).then((_jabra) => {        
        setupApiClasses([JabraType, DeviceType]);

        _jabra.on('attach', (device) => {
            addDevice(device);
            addEventMessage('attach', device);
            setupDeviceEvents(device);

            updateApiMethods();
        });

        _jabra.on('detach', (device) => {
            removeDevice(device);
            addEventMessage('detach', device);

            updateApiMethods();
        });

        _jabra.on('firstScanDone', () => {
            addEventMessage('firstScanDone');
        });
        
        jabra = _jabra
    });
    commandEffect("createApiClient", ["<ipcRenderer>"], response);
}

export function setupDeviceEvents(device: DeviceType) {
  DeviceEventsList.forEach((e) => {
    device.on(e as any, ((...args: any[]) => {      
        addEventMessage(e, ...args);
    }));
  });
}
        
  // Close API when asked.
unInitSDKBtn.onclick = () => {
    let response = jabra!.disposeAsync();
    commandEffect("disposeAsync", [], response);
};

checkInstallBtn.onclick = () => {
    let response = jabra!.getSDKVersionAsync();
    commandEffect(nameof<JabraType>("getSDKVersionAsync"), [], response);
};

/*
setupUserMediaPlaybackBtn.onclick = () => {

};*/

apiReferenceBtn.onclick = () => {
  window.electron.ipcRenderer.send(openHelpWindow);
};

function getCurrentDevice() {
    let id = Number.parseInt(deviceSelector.value);
    return jabra!.getAttachedDevices().find(device => device.deviceID === id);
}

function getCurrentApiClassObject(): JabraType | DeviceType | undefined {
    let clazzName = apiClassSelector.value;
    switch (clazzName) {
        case JabraType.name: 
             return jabra; 
             break;
        case DeviceType.name:
             return getCurrentDevice();
             break;
        default: throw new Error("Unknown Api Class '" + clazzName + "'");
    }        
}

function getCurrentMethodMeta(): MethodEntry | undefined {
    let currentApiObject = getCurrentApiClassObject(); 
    if (currentApiObject) {
        let clazzMeta = currentApiObject.getMeta();
        let selectedMethodName = methodSelector.value;
        return clazzMeta.methods.find(method => method.name === selectedMethodName);
    } else {
        return undefined;
    }
}

function updateApiMethods() {
    let currentApiObject = getCurrentApiClassObject(); 
    setupApiMethods(currentApiObject ? currentApiObject.getMeta() : undefined);
    setupApiHelp();
}

apiClassSelector.onchange = ((e) => {
    updateApiMethods();
});

showInternalsAndDeprecatedMethodsChk.onchange = ((e) => {
  updateApiMethods();
});

  // Update hints for API call:
methodSelector.onchange = ((e) => {
  setupApiHelp();
  //  TODO: Update hints for API call:
});

invokeApiBtn.onclick = () => {
    const meta = getCurrentMethodMeta();
    const currentApiObject = getCurrentApiClassObject(); 
    if (meta) {
        invokeSelectedApi(currentApiObject, meta);
    } else {
        addError("User error", "No device/api selected to invoke");
    }
}

  // Invoke API repeatedly:
stressInvokeApiBtn.onclick = () => {
    // Stop stress testing. Leave button with status if failure until repeated stop.
    function stopStressInvokeApi(success: boolean) {
      if (stressInterval) {
          clearInterval(stressInterval);
          stressInterval = undefined;
      }
      if (success) {
          stressInvokeApiBtn.value = "Invoke repeatedly (stress test)";
      }
    }
    
    let sucess = true;
    let stopped = false;
    if (stressInvokeApiBtn.value.toLowerCase().includes("stop")) {
      stopStressInvokeApi(sucess);
      stopped = true;
    } else {
      const funcMeta = getCurrentMethodMeta();
      const currentApiObject = getCurrentApiClassObject(); 
      if (!currentApiObject || !funcMeta) {
        addError("User error", "No device/api selected to invoke");
        return;
      }

      stressInvokeCount = 1;
      stressInvokeApiBtn.value = "Stop";
      stressInterval = setInterval(() => {
        if (sucess && stressInterval && funcMeta) {
          try {
            invokeSelectedApi(currentApiObject, funcMeta).then( () => {
              stressInvokeApiBtn.value = "Stop stress test (" + funcMeta!.name + " success count # " + stressInvokeCount + ")";
              ++stressInvokeCount!;
            }).catch( () => {
              stressInvokeApiBtn.value = "Stop stress test (" + funcMeta!.name + " failed at count # " + stressInvokeCount + ")";
              sucess = false;
              stopStressInvokeApi(sucess);
            });
          } catch (err) {
            stressInvokeApiBtn.value = "Stop stress test (" + funcMeta!.name + " failed with exception at count # " + stressInvokeCount + ")";
            sucess = false;
            stopStressInvokeApi(sucess);
          }
        }
      }, stressWaitInterval);
    }
};

// Resolves arguments for different API methods. All methods that require
// complex values or have default values should be explicitly handled here:
const commandArgs: { [name: string]: () => any[] } = {
  __default__: () => [ convertParam(txtParam1.value), convertParam(txtParam2.value), convertParam(txtParam3.value), convertParam(txtParam4.value), convertParam(txtParam5.value) ],
};

// Call into user selected API method.
function invokeSelectedApi(currentApiObject: JabraType | DeviceType | undefined, method: MethodEntry): Promise<any> {
    if (currentApiObject && method) {
        const apiFunc = (currentApiObject as any)[method.name];

        let argsResolver = commandArgs[method.name];
        if (!argsResolver) {
            argsResolver = commandArgs["__default__"];
        }

        let args;
        try {
         args = argsResolver();
         args = args.slice(0, Math.min(args.length, method.parameters.length));
        } catch (err) {
          addError("Parameter input error",  err);
          return Promise.reject(err);
        }

        try {
            const result = apiFunc.call(jabra, ...args);
            return commandEffect(method.name, args.map(a => paramToString(a)), result).then(() => {});
        } catch (err) {
            addError("Command execution error",  err);
            return Promise.reject(err);
        }
    } else {
        addError("No api selected to execute");
        return Promise.reject(new Error("No api selected to execute"));
    }
}

// Producable printable version of parameter
function paramToString(param: any): string {
  if (param === null) {
    return "<null>";
  } else if (param === undefined) {
    return "<undefined>"
  } else if ((param !== Object(param)) || param.hasOwnProperty('toString')) {
    return param.toString();
  } else {
    return JSON.stringify(param, null, 2);
  }
}

// Setup hints to help out with API use:
function setupApiHelp() {
  const meta = getCurrentMethodMeta();

  param1Hint.innerText = "";
  param2Hint.innerText = "";
  param3Hint.innerText = "";
  param4Hint.innerText = "";
  param5Hint.innerText = "";
  methodHelp.innerText = "";
  (txtParam1 as any).style="";
  (txtParam2 as any).style="";
  (txtParam3 as any).style="";
  (txtParam4 as any).style="";
  (txtParam5 as any).style="";

  function getInputStyle(optional: boolean) {
    return optional ? "border:1px solid #00ff00" : "border:1px solid #ff0000";
  }

  function getTypeHint(pMeta: ParameterEntry) {
    return pMeta.tsType + (pMeta.tsType !== pMeta.jsType ? " (" + pMeta.jsType + ")" : "");
  }

  if (meta) {
    methodSignature.innerText = meta.name + "( " + meta.parameters.map(p => p.name + ": " + p.tsType).join(", ") + "): " + meta.tsType;
    methodHelp.innerText = meta.documentation;

    if (meta.parameters.length>=1) {
      param1Hint.innerText = getTypeHint(meta.parameters[0]);
      (txtParam1 as any).style = getInputStyle(meta.parameters[0].optional);
    }
    if (meta.parameters.length>=2) {
      param2Hint.innerText =  getTypeHint(meta.parameters[1]);
      (txtParam2 as any).style = getInputStyle(meta.parameters[1].optional);
    }
    if (meta.parameters.length>=3) {
      param3Hint.innerText =  getTypeHint(meta.parameters[2]);
      (txtParam4 as any).style =  getInputStyle(meta.parameters[2].optional);
    }
    if (meta.parameters.length>=4) {
      param4Hint.innerText =  getTypeHint(meta.parameters[3]);
      (txtParam4 as any).style =  getInputStyle(meta.parameters[3].optional);
    }
    if (meta.parameters.length>=5) {
      param5Hint.innerText =  getTypeHint(meta.parameters[4]);
      (txtParam5 as any).style =  getInputStyle(meta.parameters[4].optional);
    }
  }
}

function convertParam(value: string): any {
    let tValue = value.trim();
    
    // Remove leading zero from numbers to avoid intreprenting them as octal.
    if (/0[0-9a-fA-F]+/.test(tValue)) {
      while (tValue.startsWith("0")) tValue=tValue.substring(1);
    }

    // Re-intreprent # prefixed numbers as hex number
    if (/#[0-9a-fA-F]+/.test(tValue)) {
      tValue = "0x" + tValue.substring(1);
    }

    // Peek and if we can find signs of non-string than evaluate it otherwise return as string.
    if (tValue.startsWith("[") 
        || tValue.startsWith("/") 
        || tValue.startsWith('"') 
        || tValue.startsWith("'") 
        || tValue.startsWith("{")
        || tValue.toLowerCase() === "true" 
        || tValue.toLowerCase() === "false"
        || (tValue.length>0 && !isNaN(tValue as any))) {
      return eval("("+tValue+")"); // Normally dangerous but since this is a test app it is acceptable.
    } else { // Assume string otherwise.
      return value;
    }
}

// Update state with result from previously executed command and return promise with result.
function commandEffect(apiFuncName: string, argDescriptions: any[], result: Promise<any> | any): Promise<any> {
    let apiCallDescription = apiFuncName + "(" + argDescriptions.join(", ") + ")";
    addStatusMessage("Api call " + apiCallDescription + " executed.");

    if (result instanceof Promise) {
      return result.then((value) => {
        // Handle special calls that must have side effects in this test application:
        if (apiFuncName === createApiClient.name) {
          // Use the Jabra library
          addStatusMessage("Jabra library initialized successfully")
          initSDKBtn.disabled = true;
          unInitSDKBtn.disabled = false;
          invokeApiBtn.disabled = false;
          stressInvokeApiBtn.disabled = false;
          // setupUserMediaPlaybackBtn.disabled = false;
          checkInstallBtn.disabled = false;

          notyf.success("Jabra library initialized successfully");
        } else if (apiFuncName === nameof<JabraType>("disposeAsync")) {
          initSDKBtn.disabled = false;
          unInitSDKBtn.disabled = true;
          // setupUserMediaPlaybackBtn.disabled = true;
          checkInstallBtn.disabled = true;
          invokeApiBtn.disabled = true;
          stressInvokeApiBtn.disabled = true;
  
          while (deviceSelector.options.length > 0) {                
            deviceSelector.remove(0);
          }
  
          variables = {
            audioElement: player,
            mediaStream: undefined,
            deviceInfo: undefined
          }
  
          notyf.success("Jabra library uninitialized");
  
          addResponseMessage(result);
        } else if (apiFuncName === "getUserDeviceMediaExt") { // TODO ???
          // Store result for future use in new API calls that needs them.
          variables.mediaStream = value.stream;
          variables.deviceInfo = value.deviceInfo;

          // Configure player to use stream
          player.srcObject =  value.stream;
          player.muted = false;

          // Print prettyfied result:
          addResponseMessage({ stream: (value.stream ? "<MediaStream instance>" : value.stream), "deviceInfo": value.deviceInfo });
          addStatusMessage("NB: Storing stream and deviceinfo to use for subsequent API calls!");
        } else if (apiFuncName === nameof<JabraType>("getAttachedDevices")) {
          while (deviceSelector.options.length > 0) {
            deviceSelector.remove(0);
          }
    
          // Normally one should not need to check for legacy_result, but for this
          // special test page we would like it to work with older extensions/chromehosts
          // while at the same time using newest JS API. This is not normally
          // supported so we need special code to deal with legazy result formats as well.
          // Do not do this yourself - upgrade dependencies or use older API.
    
            // Decode device information normally - recommended way going forward.
           (value as DeviceType[]).forEach(device => {
            var opt = document.createElement('option');
            opt.value = device.deviceID.toString();
            opt.innerHTML = device.deviceName;
            deviceSelector.appendChild(opt);
          });
    
          if (deviceSelector.options.length == 0) {
            addError("Device error", "No devices found");
          }

          addResponseMessage(value);
        } else if (apiFuncName === nameof<JabraType>("getSDKVersionAsync")) {
            nativeSdkVersion.innerHTML = value;
      
            addResponseMessage(value);

            (nativeSdkVersionContainer as any).style = "display: inline";           
        } else { // Default handling of general API call:
          // Just print output if there is any:
          if (value != undefined && value != null) {
            addResponseMessage(value);
          }
        }

        return value;
      }).catch((error) => {
        addStatusMessage("Api call " + apiFuncName + " failed");

        if (apiFuncName === "getDevices") {
          while (deviceSelector.options.length > 0) {
            deviceSelector.remove(0);
          }
        }

        addError("Api exectution error", error);

        return undefined;
      });
    } else { // Unpromised result:
      if (result != undefined && result != null) { // Default handling of general API call:
        addResponseMessage(result);
      }

      return Promise.resolve(result);
    }
}

toggleScrollMessageAreaBtn.onclick = () => {
  scrollMessageArea = !scrollMessageArea;
  toggleScrollMessageAreaBtn.value = scrollMessageArea ? "Scroll ON" : "Scroll OFF";
};

toggleScrollErrorAreaBtn.onclick = () => {
  scrollErrorArea = !scrollErrorArea;
  toggleScrollErrorAreaBtn.value = scrollErrorArea ? "Scroll ON" : "Scroll OFF";
};

clearMessageAreaBtn.onclick = () => {
  messages.clear();
  messageArea.value="";
  messagesCount.innerText = "0";
};

clearErrorAreaBtn.onclick = () => {
  errors.clear();
  errorArea.value="";
  errorsCount.innerText = "0";
};

function messageFilterAllows(str: string) {
  return messageFilter.value === "" || str.toLocaleLowerCase().includes(messageFilter.value.toLocaleLowerCase());
}

function addError(context: string, err?: Error | string) {
  let txt;
  if (typeof err === 'string' || err instanceof String) {
    txt = err;
  } else if (err instanceof Error) {
    txt = err.name + " : " + err.message;
  } else if (err === undefined) {
    txt = undefined;
  } else {
    txt = JSON.stringify(err, null, 2);
  }

  errors.push(txt ? (context + ": " + txt) : context);
  updateErrorArea();
}

function updateErrorArea() {
  let filteredErrorsArray = errors.getAll();
  errorsCount.innerText = filteredErrorsArray.length.toString();
  errorArea.value = filteredErrorsArray.join("\n");
  if (scrollErrorArea) {
    errorArea.scrollTop = errorArea.scrollHeight;
  }
}

function addStatusMessage(msg: string | any) {
  let txt = (typeof msg === 'string' || msg instanceof String) ? msg.toString() : "Status: " + JSON.stringify(msg, null, 2);
  messages.push(txt);
  updateMessageArea();
}

function addResponseMessage(msg: string | any) {
  let txt = (typeof msg === 'string' || msg instanceof String) ? "response string: " + msg.toString() : "response object: " + JSON.stringify(msg, null, 2);
  messages.push(txt);
  updateMessageArea();
}

function addEventMessage(eventName: string, ...args: any[]) {
  let txt = "Received event " + eventName + " with arguments ";

  let firstArg = true;
  for (let arg of args) {
    if (firstArg) {
      firstArg = false;
    } else {
      txt = txt + ", ";
    }
    let argV = (arg !== Object(arg)) ? arg.toString() : JSON.stringify(arg, null, 2);
    txt = txt + argV;    
  }
  
  messages.push(txt);
  updateMessageArea();
}

function updateMessageArea() {
  let filteredMessagesArray = messages.getAll().filter(txt => messageFilterAllows(txt));
  messageArea.value = filteredMessagesArray.join("\n");
  messagesCount.innerText = filteredMessagesArray.length.toString();
  if (scrollMessageArea) {
      messageArea.scrollTop = messageArea.scrollHeight;
  }
}

copyMessagesBtn.onclick = () => {
  let clipText = messages.getAll().filter(txt => messageFilterAllows(txt)).join("\n");
  navigator.clipboard.writeText(clipText)
  .then(() => {})
  .catch(err => {
    addError("Internal error", "Could not copy to clipboard");
  });
};

messageFilter.oninput = () => {
  updateMessageArea();
};





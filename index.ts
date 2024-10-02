import { networkInterfaces } from "os";
import { spawn } from "child_process";

function mockInDev<
  F extends (...args: unknown[]) => unknown,
  T extends Awaited<ReturnType<F>>
>(
  originalFunction: F,
  mockData: T extends Array<any> ? Partial<T[number]>[] : Partial<T>
): F {
  console.log(process.platform, process.env.NODE_ENV);
  if (process.platform === "linux")
    // || process.env.NODE_ENV !== "development")
    return originalFunction;

  async function artificiallyDelayedMock() {
    if (process.env.NODE_ENV === "test") return mockData;

    return new Promise((resolve) => {
      setTimeout(() => resolve(mockData), 1000);
    });
  }

  return artificiallyDelayedMock as F;
}

// collect ip4 addresses using "os" module
export const getIPv4 = () => {
  type IPv4Entry = { address: string; netmask: string; mac: string };
  return new Promise<IPv4Entry[]>((resolve, reject) => {
    try {
      const interfaces = networkInterfaces();
      let items: IPv4Entry[] = [];
      for (const key in interfaces) {
        if (Object.hasOwnProperty.call(interfaces, key)) {
          const element = interfaces[key];
          if (element) {
            for (const item of element) {
              if (!item.internal && item.family === "IPv4")
                items.push({
                  address: item.address,
                  netmask: item.netmask,
                  mac: item.mac,
                });
            }
          }
        }
      }
      resolve(items);
    } catch (error) {
      reject(error);
    }
  });
};

// stringToJson convertor
const stringToJson = <T = unknown>(stringData: string): T[] => {
  const data = stringData
    .toString()
    .split("\n")
    .map((keyVal) => {
      const index = keyVal.indexOf(":");
      const obj: unknown = {};
      obj[keyVal.slice(0, index)] = keyVal.slice(index + 1).replace(/^ */, "");
      return obj;
    });
  const firstKey = Object.keys(data[0])[0];
  let i = 1;
  for (i = 1; i < data.length; i++) {
    const element = Object.keys(data[i])[0];
    if (element === firstKey) {
      break;
    }
  }

  let list: T[] = [];
  for (let index = 0; index < data.length; index += i) {
    let obj = {};
    data.slice(index, index + i).forEach((item) => {
      const key = Object.keys(item)[0];
      if (key) obj[key] = item[key];
    });
    if (!!Object.keys(obj).length) list.push(obj as T);
  }

  return list;
};

// nmcli request for single answer or without answer
const cli = (args: string[]) =>
  new Promise<string | number | null>((resolve, reject) => {
    let resolved = false;
    try {
      const nmcli = spawn("nmcli", args);
      nmcli.stdout.on("data", (data: string) => {
        if (resolved) return;
        resolved = true;
        resolve(data.toString().trim());
      });
      nmcli.stderr.on("data", (data: string) => {
        if (resolved) return;
        resolved = true;
        reject(data.toString().trim());
      });
      nmcli.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        resolve(code);
      });
    } catch (err) {
      if (resolved) return;
      resolved = true;
      reject(err);
    }
  });

// nmcli request for multiline answer
const clib = <T = unknown>(args: string[]) =>
  new Promise<T[]>((resolve, reject) => {
    let resolved = false;
    try {
      const nmcli = spawn("nmcli", args);
      const body: string[] = [];
      nmcli.stdout.on("data", (data: string) => {
        body.push(data);
      });
      nmcli.stderr.on("data", (data: string) => {
        if (resolved) return;
        resolved = true;
        reject(data.toString());
      });
      nmcli.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        try {
          if (code !== 0) return reject(code);
          resolve(stringToJson<T>(body.join("")));
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });

// activity monitor stream
export const activityMonitor = (stream) =>
  new Promise((resolve, reject) => {
    try {
      const nmcli = spawn("nmcli", ["monitor"]);
      nmcli.stdout.pipe(stream, { end: false });

      function endStream() {
        nmcli.kill("SIGHUP");
      }

      resolve(endStream);
    } catch (error) {
      reject(error);
    }
  });

// hostname
export const getHostName = () => cli(["general", "hostname"]);
export const setHostName = (hostName: string) =>
  cli(["general", "hostname", String(hostName)]);
// networking
export const enable = () => cli(["networking", "on"]);
export const disable = () => cli(["networking", "off"]);
export const getNetworkConnectivityState = (reChecking = false) =>
  cli(
    reChecking
      ? ["networking", "connectivity", "check"]
      : ["networking", "connectivity"]
  );
// connections (profiles)
export const connectionUp = (profile) =>
  cli(["connection", "up", String(profile)]);
export const connectionDown = (profile) =>
  cli(["connection", "down", String(profile)]);
export const connectionDelete = (profile) =>
  cli(["connection", "delete", String(profile)]);
export const getConnectionProfilesList = (active = false) =>
  clib(
    active
      ? [
          "-m",
          "multiline",
          "connection",
          "show",
          "--active",
          "--order",
          "active:name",
        ]
      : ["-m", "multiline", "connection", "show", "--order", "active:name"]
  );
export const changeDnsConnection = (profile, dns) =>
  cli(["connection", "modify", String(profile), "ipv4.dns", String(dns)]);
export const addEthernetConnection = (
  connection_name: string,
  interf = "enp0s3",
  ipv4: string,
  gateway: string
) =>
  cli([
    "connection",
    "add",
    "type",
    "ethernet",
    "con-name",
    connection_name,
    "ifname",
    interf,
    "ipv4.method",
    "manual",
    "ipv4.addresses",
    `${ipv4}/24`,
    "gw4",
    gateway,
  ]);
export const addGsmConnection = (
  connection_name: string,
  interf = "*",
  apn: string,
  username: string,
  password: string,
  pin: string
) => {
  let cmd = [
    "connection",
    "add",
    "type",
    "gsm",
    "con-name",
    connection_name,
    "ifname",
    interf,
  ];

  if (apn) {
    cmd.push("apn");
    cmd.push(String(apn));
  }

  if (username) {
    cmd.push("username");
    cmd.push(String(username));
  }

  if (password) {
    cmd.push("password");
    cmd.push(String(password));
  }

  if (pin) {
    cmd.push("pin");
    cmd.push(String(pin));
  }

  return cli(cmd);
};
// devices
export const deviceConnect = (device) =>
  cli(["device", "connect", String(device)]);
export const deviceDisconnect = (device) =>
  cli(["device", "disconnect", String(device)]);
export const deviceStatus = async () => {
  const data = await clib(["device", "status"]);
  return Object.keys(data[0])
    .map((line) => {
      if (line.startsWith("DEVICE")) return null; // filter first line
      const lines = line
        .replaceAll(/\s{2,}/g, " ")
        .trim()
        .split(" ");

      return {
        device: lines.shift(),
        type: lines.shift(),
        state: lines.shift(),
        connection: lines.join(" "),
      };
    })
    .filter((x) => !!x); // filter first line
};
export const getDeviceInfoIPDetail = async (deviceName) => {
  const statesMap = {
    10: "unmanaged",
    30: "disconnected",
    100: "connected",
  };
  const data = await clib(["device", "show", String(deviceName)]);
  return data.map((item) => {
    const state = parseInt(item["GENERAL.STATE"]) || 10; // unmanaged by default
    return {
      device: item["GENERAL.DEVICE"],
      type: item["GENERAL.TYPE"],
      state: statesMap[state],
      connection: item["GENERAL.CONNECTION"],
      mac: item["GENERAL.HWADDR"],
      ipV4: item["IP4.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV4: item["IP4.ADDRESS[1]"],
      gatewayV4: item["IP4.GATEWAY"],
      ipV6: item["IP6.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV6: item["IP6.ADDRESS[1]"],
      gatewayV6: item["IP6.GATEWAY"],
    };
  })[0];
};
export const getAllDeviceInfoIPDetail = async () => {
  const statesMap = {
    10: "unmanaged",
    30: "disconnected",
    100: "connected",
  };
  const data = await clib(["device", "show"]);
  return data.map((item) => {
    const state = parseInt(item["GENERAL.STATE"]) || 10; // unmanaged by default
    return {
      device: item["GENERAL.DEVICE"],
      type: item["GENERAL.TYPE"],
      state: statesMap[state],
      connection: item["GENERAL.CONNECTION"],
      mac: item["GENERAL.HWADDR"],
      ipV4: item["IP4.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV4: item["IP4.ADDRESS[1]"],
      gatewayV4: item["IP4.GATEWAY"],
      ipV6: item["IP6.ADDRESS[1]"]?.replace(/\/[0-9]{2}/g, ""),
      netV6: item["IP6.ADDRESS[1]"],
      gatewayV6: item["IP6.GATEWAY"],
    };
  });
};

// wifi
export const wifiEnable = () => cli(["radio", "wifi", "on"]);
export const wifiDisable = () => cli(["radio", "wifi", "off"]);
export const getWifiStatus = () => cli(["radio", "wifi"]);
export const wifiHotspot = async (
  ifname: string,
  ssid: string,
  password: string
) =>
  clib([
    "device",
    "wifi",
    "hotspot",
    "ifname",
    String(ifname),
    "ssid",
    ssid,
    "password",
    password,
  ]);

export const wifiCredentials = async (ifname: string) => {
  if (!ifname) throw Error("ifname required!");
  const data = await clib([
    "device",
    "wifi",
    "show-password",
    "ifname",
    ifname,
  ]);
  return data[0];
};

export interface WifiListItem {
  "IN-USE": string;
  BSSID: string;
  SSID: string;
  MODE: string;
  CHAN: string;
  RATE: string;
  SIGNAL: string;
  BARS: string;
  SECURITY: string;
}

export const getWifiList = mockInDev(
  async (reScan = false) => {
    const data = await clib<WifiListItem>(
      reScan
        ? ["-m", "multiline", "device", "wifi", "list", "--rescan", "yes"]
        : ["-m", "multiline", "device", "wifi", "list", "--rescan", "no"]
    );
    return data.map((el) => {
      return { ...el, inUseBoolean: el["IN-USE"] === "*" };
    });
  },
  [
    { SSID: "Insecure Network", SECURITY: "--", SIGNAL: "42" },
    { SSID: "Better Network", SECURITY: "WEP", SIGNAL: "69" },
    { SSID: "Best-WiFi", SECURITY: "WPA2", SIGNAL: "84" },
  ]
);

export const wifiConnect = (ssid: string, password: string, hidden = false) => {
  if (!hidden) {
    return cli([
      "device",
      "wifi",
      "connect",
      String(ssid),
      "password",
      String(password),
    ]);
  } else {
    return cli([
      "device",
      "wifi",
      "connect",
      String(ssid),
      "password",
      String(password),
      "hidden",
      "yes",
    ]);
  }
};

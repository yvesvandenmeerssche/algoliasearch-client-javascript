// @flow

import HostGenerator from './HostGenerator';
import TimeoutGenerator from './TimeoutGenerator';

import type { AppId, ApiKey } from 'algoliasearch';
import type {
  RequestOptions,
  RequestArguments,
  Result,
  HttpModule,
  Timeouts,
  Hosts,
  ErrorType,
  RequesterError,
  CreateRequester,
} from 'algoliasearch-requester';

const stringify = qs => JSON.stringify(qs); // todo: use proper url stringify

const retryableErrors: Array<ErrorType> = [
  'application',
  'network',
  'dns',
  'timeout',
];

// eslint-disable-next-line no-unused-vars
const RESET_HOST_TIMER = 12000; // ms; 2 minutes
// eslint-disable-next-line no-unused-vars
const RESET_TIMEOUT_TIMER = 120000; // ms; 20 minutes

export class Requester {
  hostGenerator: HostGenerator;
  timeoutGenerator: TimeoutGenerator;
  apiKey: ApiKey;
  appId: AppId;
  requestOptions: RequestOptions;
  requester: HttpModule;

  constructor({
    appId,
    apiKey,
    httpRequester,
    options: { timeouts = {}, extraHosts = {} } = {},
    requestOptions = {},
  }: {|
    appId?: AppId,
    apiKey: ApiKey,
    httpRequester: HttpModule,
    options?: {|
      timeouts?: Timeouts,
      extraHosts?: Hosts,
    |},
    requestOptions?: RequestOptions,
  |}) {
    if (typeof appId !== 'string') {
      throw new Error(
        `appId is required and should be a string, received "${appId || ''}"`
      );
    }
    if (typeof apiKey !== 'string') {
      throw new Error(
        `apiKey is required and should be a string, received ${apiKey}`
      );
    }
    if (typeof httpRequester !== 'function') {
      throw new Error(
        `httpRequester is required and should be a function, received ${httpRequester}`
      );
    }
    this.hostGenerator = new HostGenerator({ appId, extraHosts });
    this.timeoutGenerator = new TimeoutGenerator({ timeouts });
    this.appId = appId;
    this.apiKey = apiKey;
    this.requester = httpRequester;
    this.requestOptions = requestOptions;
  }

  setOptions = (fn: RequestOptions => RequestOptions): RequestOptions => {
    const oldOptions = this.requestOptions;
    const newOptions = fn(oldOptions);
    this.requestOptions = newOptions;
    return newOptions;
  };

  request = ({
    method,
    path,
    qs,
    body,
    options,
    requestType: type,
    timeoutRetries = 0,
  }: RequestArguments): Promise<Result> => {
    const hostname = this.hostGenerator.getHost({ type });
    const timeout = this.timeoutGenerator.getTimeout({
      retry: timeoutRetries,
      type,
    });

    const pathname = path + stringify(qs);
    const url = { hostname, pathname };

    return this.requester({
      body,
      method,
      url,
      timeout,
      options,
      requestType: type,
    }).catch(err =>
      this.retryRequest(err, {
        method,
        path,
        qs,
        body,
        options,
        type,
        timeoutRetries,
      })
    );
  };

  retryRequest = (
    err: RequesterError,
    requestArguments: RequestArguments
  ): Promise<Result> => {
    if (retryableErrors.indexOf(err.reason) > -1) {
      // if no more hosts or timeouts: reject
      // if reason: timeout; increase
      const timeoutRetries =
        err.reason === 'timeout'
          ? requestArguments.timeoutRetries + 1
          : requestArguments.timeoutRetries;

      const res = this.request({
        ...requestArguments,
        requestType: requestArguments.type,
        timeoutRetries,
      });

      return res;
    }

    return Promise.reject(
      new Error({
        reason:
          "Request couldn't be retried, did you enter the correct credentials?",
        more: err,
      })
    );
  };
}

const createRequester: CreateRequester = function createRequester(args) {
  const _r = new Requester(args);
  const requester = _r.request;
  requester.setOptions = _r.setOptions;
  requester.options = _r.requestOptions;
  return requester;
};

createRequester(5);

export default createRequester;

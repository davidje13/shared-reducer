export class ControllablePromiseFactory<T> {
  public preResolve: T | undefined = undefined;
  public preReject: Error | undefined = undefined;
  public hasStarted = false;

  public resolve = (v: T) => {
    this.preResolve = v;
  };

  public reject = (v: Error) => {
    this.preReject = v;
  };

  public build = () =>
    new Promise<T>((resolve, reject) => {
      this.hasStarted = true;
      this.resolve = resolve;
      this.reject = reject;
      if (this.preResolve !== undefined) {
        this.resolve(this.preResolve);
      }
      if (this.preReject !== undefined) {
        this.reject(this.preReject);
      }
    });
}

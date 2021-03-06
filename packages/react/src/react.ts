import React, { FunctionComponent } from 'react';
import ReactDOM from 'react-dom';
import { Application, TApplicationOptions, Context, TAnnotationScanerMethod, TApplicationLifeCycles } from '@typeclient/core';
import { CreateGlobalComponent, TReactPortalContext } from './components/global';
import { NAMESPACE } from './annotations';
import { ContextProvider, useReactiveState } from './reactive';
import { reactive, Ref, UnwrapRef } from '@vue/reactivity';

export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>;
export type TReactApplicationOptions = TApplicationOptions & { el: HTMLElement };
export type TSlotState = UnwrapNestedRefs<Record<string, React.ReactNode>>;

export class ReactApplication extends Application implements TApplicationLifeCycles<React.ReactElement> {
  private readonly element: HTMLElement;
  public readonly FCS: WeakMap<any, Map<string, React.FunctionComponent<any>>> = new WeakMap();
  public readonly slotState: TSlotState = reactive({});
  public readonly slotContext: React.Context<TSlotState> = React.createContext(this.slotState);
  private portalDispatcher: React.Dispatch<React.SetStateAction<TReactPortalContext<any>>>;
  constructor(options: TReactApplicationOptions) {
    super(options);
    this.element = options.el;
    this.installContextTask();
  }

  public applicationComponentRender(ctx: Context, server: any, key: string, metadata: TAnnotationScanerMethod) {
    return this.applicationRendering(ctx, server, key, metadata);
  }

  public applicationErrorRender(node: React.ReactElement) {
    if (this.portalDispatcher) {
      this.portalDispatcher({
        context: null,
        template: null,
        slot: () => node,
      })
    }
  }

  public applicationInitialize(next: () => void) {
    return this.applicationWillSetup(this.element, next);
  }

  private installContextTask() {
    let cmp: FunctionComponent = null;
    let state: any = null;
    this.setBeforeContextCreate(props => {
      const fn = this.getLazyServerKeyCallback(props.server, props.key as string);
      const _state = typeof props.state === 'function' ? props.state() : props.state;
      if (cmp && fn === cmp) {
        state = Object.assign(state, _state);
        return props.next(state);
      }
      state = _state;
      cmp = fn;
      props.next(state);
    });
  }

  public setPortalReceiver<T extends Context = Context>(fn: React.Dispatch<React.SetStateAction<TReactPortalContext<T>>>) {
    if (!this.portalDispatcher) this.portalDispatcher = fn;
    return this;
  }

  private applicationWillSetup(el: HTMLElement, next: () => void) {
    const GlobalComponent = CreateGlobalComponent(this);
    ReactDOM.render(React.createElement(GlobalComponent), el);
    next();
  }

  private applicationRendering(ctx: Context, server: any, key: string, metadata: TAnnotationScanerMethod) {
    const classModuleMetaData = metadata.meta.parent;
    const TemplateComponent = classModuleMetaData.got<React.FunctionComponent>(NAMESPACE.TEMPLATE, null);
    const LazyComponent = this.getLazyServerKeyCallback(server, key);

    if (this.portalDispatcher) {
      this.portalDispatcher({
        context: ctx,
        template: TemplateComponent,
        slot: LazyComponent,
      })
    }
  }

  private getLazyServerKeyCallback(server: any, key: string): React.FunctionComponent<any> {
    const constructor = server.constructor;
    if (!this.FCS.has(constructor)) this.FCS.set(constructor, new Map());
    const fcs = this.FCS.get(constructor);
    if (!fcs.has(key)) {
      const Component = server[key].bind(server);
      const Checker = (ctx: Context) => {
        const { status, error } = useReactiveState(() => ({ 
          status: ctx.status.value,
          error: ctx.error.value,
        }));
 
        return status === 500 
          ? error || null
          : React.createElement(Component, ctx);
      }
      const CMP = (ctx: Context) => React.createElement(
        ContextProvider, { value: ctx }, 
        React.createElement(Checker, ctx)
      )
      fcs.set(key, CMP);
    }
    return fcs.get(key);
  }
}
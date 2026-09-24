// 本地最小 React 类型声明：本项目不新增 npm 依赖，
// 仅声明代码中实际用到的 hooks、JSX 节点与常用事件类型。

declare module "react" {
  export type ReactNode =
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactElement
    | ReactNode[];

  export interface ReactElement {
    type: unknown;
    props: Record<string, unknown>;
    key?: string | number | null;
  }

  type Setter<T> = (value: T | ((prev: T) => T)) => void;
  type Initializer<T> = T | (() => T);

  export function useState<T>(initial: Initializer<T>): [T, Setter<T>];
  export function useMemo<T>(factory: () => T, deps: unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps: unknown[]): void;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;

  export interface ChangeEvent<T = Element> {
    target: T;
    currentTarget: T;
  }

  export interface FormEvent {
    preventDefault(): void;
  }

  export interface MouseEvent {
    preventDefault(): void;
  }

  const React: {
    createElement: (...args: unknown[]) => ReactElement;
    StrictMode: (props: { children?: unknown }) => ReactElement;
  };
  export default React;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";

  interface Root {
    render(node: ReactNode): void;
  }

  export function createRoot(container: Element | DocumentFragment | null): Root;
}

declare module "react/jsx-runtime" {
  export function jsx(type: unknown, props: Record<string, unknown>, key?: string | number): unknown;
  export function jsxs(type: unknown, props: Record<string, unknown>, key?: string | number): unknown;
  export const Fragment: unique symbol;
}

declare namespace JSX {
  interface Element {
    type: unknown;
    props: Record<string, unknown>;
    key?: string | number | null;
  }

  interface ElementClass {
    render(): unknown;
  }

  interface ElementAttributesProperty {
    props: Record<string, unknown>;
  }

  interface ElementChildrenAttribute {
    children: unknown;
  }

  type LibraryManagedAttributes<C, P> = P;

  interface IntrinsicAttributes {
    key?: string | number | null;
  }

  interface DOMAttributes {
    children?: unknown;
    key?: string | number | null;
    onClick?: (e: { preventDefault(): void }) => void;
    onChange?: (e: { target: HTMLTarget }) => void;
    onSubmit?: (e: { preventDefault(): void }) => void;
    title?: string;
    role?: string;
    "aria-label"?: string;
  }

  interface HTMLTarget {
    value: string;
  }

  interface HTMLAttributes extends DOMAttributes {
    className?: string;
    defaultValue?: string;
    disabled?: boolean;
    href?: string;
    min?: number | string;
    placeholder?: string;
    type?: string;
    value?: string | number;
    viewBox?: string;
    style?: Record<string, string | number>;
  }

  interface SVGAttributes extends DOMAttributes {
    className?: string;
    cx?: number | string;
    cy?: number | string;
    r?: number | string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number | string;
    strokeDasharray?: string;
    viewBox?: string;
  }

  interface InputAttributes extends HTMLAttributes {}
  interface SelectAttributes extends HTMLAttributes {}
  interface ButtonAttributes extends HTMLAttributes {}

  interface IntrinsicElements {
    main: HTMLAttributes;
    nav: HTMLAttributes;
    section: HTMLAttributes;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    header: HTMLAttributes;
    footer: HTMLAttributes;
    div: HTMLAttributes;
    span: HTMLAttributes;
    em: HTMLAttributes;
    i: HTMLAttributes;
    b: HTMLAttributes;
    small: HTMLAttributes;
    strong: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    p: HTMLAttributes;
    ul: HTMLAttributes;
    li: HTMLAttributes;
    label: HTMLAttributes;
    button: ButtonAttributes;
    input: InputAttributes;
    select: SelectAttributes;
    option: HTMLAttributes;
    table: HTMLAttributes;
    thead: HTMLAttributes;
    tbody: HTMLAttributes;
    tr: HTMLAttributes;
    th: HTMLAttributes;
    td: HTMLAttributes;
    svg: SVGAttributes;
    circle: SVGAttributes;
    title: HTMLAttributes;
  }
}

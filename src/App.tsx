import "./styles.css";
import ReceiptDesk from "./business/ReceiptDesk";

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62006 · 珠宝镶嵌工作室 · Port 62006</p>
        <h1>镶嵌回执核销台</h1>
        <span>
          师傅镶嵌完凭便签交回执：每张回执绑定订单，记录交付时间、师傅和成品数；裸石按原单逐颗核对，
          缺件、串单或编号不符一律列冲突并挡住核销。核销后待镶数、成品清单与尺寸筛选同步变化，
          核销前改配会把原回执退回待处理。
        </span>
      </section>

      <ReceiptDesk />
    </main>
  );
}

export default App;

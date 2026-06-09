const {io}=require("socket.io-client");
const a=io("http://localhost:4300"),b=io("http://localhost:4300");
let states=0;
a.on("state",()=>states++);
(async()=>{
 const emit=(s,e,p)=>new Promise(r=>s.emit(e,p,r));
 await new Promise(r=>a.on("connect",r)); await new Promise(r=>b.on("connect",r));
 const c=await emit(a,"room:create",{name:"A",physics:{ACCEL:38,FRICTION:4.2,MAX_SPEED:13,BOUNCE:0.4}});
 await emit(b,"room:join",{code:c.code,name:"B",physics:{ACCEL:999,FRICTION:0,MAX_SPEED:999,BOUNCE:2}});
 a.emit("room:settings",{physics:{ACCEL:30}});
 const st=await emit(a,"room:start");
 setTimeout(()=>{console.log("start ok:",st.ok,"| states received:",states>0);process.exit(0);},1500);
})();

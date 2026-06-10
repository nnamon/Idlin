//! End-to-end tests for the .bot language: compile, run on the real VM,
//! inspect memory/stack/syscalls.

use idlin_botc::compile;
use idlin_vm::{RunExit, Vm};

/// Run one tick (until Halt).
fn tick(vm: &mut Vm) {
    let mut budget = 100_000;
    assert_eq!(vm.run(&mut budget), RunExit::Halted, "tick must halt");
}

fn run_once(src: &str) -> Vm {
    let prog = compile(src).expect("compiles");
    let mut vm = Vm::new(&prog).expect("valid container");
    tick(&mut vm);
    vm
}

#[test]
fn arithmetic_and_precedence() {
    let vm = run_once(
        "fn main() {
            mem[0xC800] = 2 + 3 * 4;              // 14
            mem[0xC804] = (2 + 3) * 4;            // 20
            mem[0xC808] = 7 / 2;                  // 3
            mem[0xC80C] = -7 % 3;                 // -1 (Rust rem semantics)
            mem[0xC810] = 1 << 4 | 3;             // 19
            mem[0xC814] = 10 - 2 - 3;             // 5 (left assoc)
        }",
    );
    assert_eq!(vm.load_i32(0xC800), 14);
    assert_eq!(vm.load_i32(0xC804), 20);
    assert_eq!(vm.load_i32(0xC808), 3);
    assert_eq!(vm.load_i32(0xC80C), -1);
    assert_eq!(vm.load_i32(0xC810), 19);
    assert_eq!(vm.load_i32(0xC814), 5);
}

#[test]
fn control_flow() {
    let vm = run_once(
        "fn main() {
            var i = 0;
            var sum = 0;
            while (i < 100) {
                i = i + 1;
                if (i % 2 == 0) { continue; }
                if (i > 10) { break; }
                sum = sum + i;                    // 1+3+5+7+9 = 25
            }
            mem[0xC800] = sum;
            if (sum == 25) { mem[0xC804] = 1; } else { mem[0xC804] = 2; }
            if (sum == 24) { mem[0xC808] = 1; } else if (sum == 25) { mem[0xC808] = 3; }
        }",
    );
    assert_eq!(vm.load_i32(0xC800), 25);
    assert_eq!(vm.load_i32(0xC804), 1);
    assert_eq!(vm.load_i32(0xC808), 3);
}

#[test]
fn functions_args_returns() {
    let vm = run_once(
        "fn add3(a, b, c) { return a + b + c; }
         fn double(x) { return x * 2; }
         fn main() {
             mem[0xC800] = add3(1, 2, 3);
             mem[0xC804] = double(add3(10, 20, 30));   // nested call: 120
             mem[0xC808] = abs(-9) + min(3, 7) + max(3, 7);  // 9+3+7 = 19
         }",
    );
    assert_eq!(vm.load_i32(0xC800), 6);
    assert_eq!(vm.load_i32(0xC804), 120);
    assert_eq!(vm.load_i32(0xC808), 19);
}

#[test]
fn arrays_and_pointers() {
    let vm = run_once(
        "var buf[8];
         fn main() {
             var i = 0;
             while (i < 8) { buf[i] = i * i; i = i + 1; }
             mem[0xC800] = buf[5];                 // 25
             var p = buf;                          // array name = address
             mem[0xC804] = p[3];                   // scalar indexing = pointer
         }",
    );
    assert_eq!(vm.load_i32(0xC800), 25);
    assert_eq!(vm.load_i32(0xC804), 9);
}

#[test]
fn globals_persist_across_ticks_and_init_runs_once() {
    let prog = compile(
        "var counter = 100;
         fn main() { counter = counter + 1; mem[0xC800] = counter; }",
    )
    .unwrap();
    let mut vm = Vm::new(&prog).unwrap();
    tick(&mut vm);
    assert_eq!(vm.load_i32(0xC800), 101);
    tick(&mut vm);
    tick(&mut vm);
    assert_eq!(vm.load_i32(0xC800), 103, "init must not re-run per tick");
}

#[test]
fn logical_ops_and_not() {
    let vm = run_once(
        "fn main() {
            mem[0xC800] = 5 && 3;       // 1
            mem[0xC804] = 5 && 0;       // 0
            mem[0xC808] = 0 || 7;       // 1
            mem[0xC80C] = !7;           // 0
            mem[0xC810] = !0;           // 1
            mem[0xC814] = ~0;           // -1
        }",
    );
    assert_eq!(vm.load_i32(0xC800), 1);
    assert_eq!(vm.load_i32(0xC804), 0);
    assert_eq!(vm.load_i32(0xC808), 1);
    assert_eq!(vm.load_i32(0xC80C), 0);
    assert_eq!(vm.load_i32(0xC810), 1);
    assert_eq!(vm.load_i32(0xC814), -1);
}

#[test]
fn syscalls_follow_the_abi() {
    let prog = compile("fn main() { mem[0xC800] = read_entities(0xE100, 8, 1); }").unwrap();
    let mut vm = Vm::new(&prog).unwrap();
    let mut budget = 100_000;
    // ReadEntities = syscall 2, argc 3, args popped first-arg-first.
    assert_eq!(vm.run(&mut budget), RunExit::Syscall { number: 2, argc: 3 });
    assert_eq!(vm.pop(), 0xE100); // arg1: out_addr
    assert_eq!(vm.pop(), 8); // arg2: max
    assert_eq!(vm.pop(), 1); // arg3: filter
    vm.push(5); // host result
    assert_eq!(vm.run(&mut budget), RunExit::Halted);
    assert_eq!(vm.load_i32(0xC800), 5);
}

#[test]
fn halt_mid_function_resumes_next_tick() {
    let prog = compile(
        "fn main() {
            mem[0xC800] = mem[0xC800] + 1;
            halt();                                // tick ends HERE
            mem[0xC804] = mem[0xC804] + 10;        // runs at start of next tick
        }",
    )
    .unwrap();
    let mut vm = Vm::new(&prog).unwrap();
    tick(&mut vm);
    assert_eq!((vm.load_i32(0xC800), vm.load_i32(0xC804)), (1, 0));
    tick(&mut vm); // resumes after halt(), finishes main, ends at the loop's halt
    assert_eq!((vm.load_i32(0xC800), vm.load_i32(0xC804)), (1, 10));
    tick(&mut vm); // fresh main invocation up to halt() again
    assert_eq!((vm.load_i32(0xC800), vm.load_i32(0xC804)), (2, 10));
}

#[test]
fn fixed_point_builtins() {
    let vm = run_once(
        "fn main() {
            mem[0xC800] = mulfx(0x28000, 0x40000);   // 2.5 * 4.0 = 10.0
            mem[0xC804] = divfx(0xA0000, 0x40000);   // 10.0 / 4.0 = 2.5
        }",
    );
    assert_eq!(vm.load_i32(0xC800), 0xA_0000);
    assert_eq!(vm.load_i32(0xC804), 0x2_8000);
}

#[test]
fn errors_are_helpful() {
    assert!(
        compile("fn main() { x = 1; }")
            .unwrap_err()
            .msg
            .contains("unknown variable")
    );
    assert!(
        compile("fn main() { move_to(1); }")
            .unwrap_err()
            .msg
            .contains("2 argument")
    );
    assert!(compile("fn helper() {}").unwrap_err().msg.contains("main"));
    assert!(
        compile("fn main() { break; }")
            .unwrap_err()
            .msg
            .contains("outside a loop")
    );
    let err = compile("fn main() {\n  var x = ;\n}").unwrap_err();
    assert_eq!(err.line, 2);
}

//! The Idlin server as a LIBRARY (#148 A6): the binaries (`idlin-server`,
//! `harness`) share these modules — the harness bin reuses the band tests'
//! exact salt-road loop instead of forking it.

pub mod director;
pub mod persist;
pub mod replication;
pub mod runner;
